import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { testDatabase, resetDatabase } from "@didit-events/core/testing/database";
import { queryable } from "@didit-events/core/db/tx";
import { bootstrapApiToken, createApiTokenService } from "@didit-events/core/api-tokens";
import { requireStaffByToken } from "@didit-events/core/identity/tokens";
import { createMcpHandler, safeError } from "./handler";
import { managerTools, schemas, toolDefinitions } from "./schemas";
import { publicImageAddress, downloadImage } from "./images";
import { createTools } from "./tools";
import { testStaffSession } from "@didit-events/core/testing/staff-session";

describe("MCP transport and personal tokens", () => {
  let database: Awaited<ReturnType<typeof testDatabase>>, token: string, tokenId: string;
  let handle: ReturnType<typeof createMcpHandler>;
  const q = () => queryable(database.db);
  beforeAll(async () => { database = await testDatabase("pglite"); handle = createMcpHandler({ db: database.db }); });
  afterAll(async () => database?.close());
  beforeEach(async () => {
    await resetDatabase(database.db);
    await q().query("insert into staff(email,role) values('owner@didit.me','owner')");
    const issued = await bootstrapApiToken("owner@didit.me", "test-client", database.db); token = issued.token; tokenId = issued.metadata.id;
  });
  function request(body: unknown = { jsonrpc: "2.0", id: 1, method: "ping" }, extra: HeadersInit = {}, method = "POST") {
    return handle(new Request("http://localhost/api/mcp", { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...extra }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }));
  }
  async function call(name: string, args: unknown = {}) { return (await request({ jsonrpc: "2.0", id: 0, method: "tools/call", params: { name, arguments: args } })).json(); }
  it.each(["2025-06-18", "2025-03-26", "future"])("initializes %s and negotiates supported versions", async version => {
    const response = await request({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: "init", result: { protocolVersion: version === "future" ? "2025-06-18" : version, serverInfo: { name: "didit-events", version: "1.0.0" }, capabilities: { tools: {} } } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("acknowledges initialized, ping, DELETE; GET has no SSE", async () => {
    const notification = await request({ jsonrpc: "2.0", method: "notifications/initialized" }); expect(notification.status).toBe(202); expect(await notification.text()).toBe("");
    expect(await (await request()).json()).toMatchObject({ result: {} });
    const removed = await request(undefined, {}, "DELETE"); expect(removed.status).toBe(204); expect(await removed.text()).toBe("");
    const get = await request(undefined, {}, "GET"); expect(get.status).toBe(405); expect(get.headers.get("allow")).toBe("POST, DELETE");
  });
  it("lists all tools and calls whoami with matching text and structured content", async () => {
    const listed = await (await request({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
    expect(listed.result.tools).toEqual(toolDefinitions()); expect(listed.result.tools).toHaveLength(30);
    const body = await call("whoami");
    expect(body.id).toBe(0); expect(body.result.structuredContent).toMatchObject({ email: "owner@didit.me", role: "owner", tokenName: "test-client" });
    expect(JSON.parse(body.result.content[0].text)).toEqual(body.result.structuredContent);
    expect((await q().query("select last_used_at from api_tokens where id=$1", [tokenId]))[0]?.last_used_at).toBeInstanceOf(Date);
  });
  it("rejects batches, malformed JSON, invalid RPC, methods, tool names and arguments", async () => {
    expect((await request([{ jsonrpc: "2.0", id: 1, method: "ping" }])).status).toBe(400);
    const malformed = await handle(new Request("http://localhost/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{" }));
    expect(await malformed.json()).toMatchObject({ error: { code: -32700 } });
    expect(await (await request({ jsonrpc: "1.0", id: 1, method: "ping" })).json()).toMatchObject({ error: { code: -32600 } });
    expect(await (await request({ jsonrpc: "2.0", id: 1, method: "missing" })).json()).toMatchObject({ error: { code: -32601 } });
    expect(await call("toString")).toMatchObject({ error: { code: -32602 } });
    expect(await call("event_get", { eventId: "" })).toMatchObject({ result: { isError: true } });
    expect(await call("event_get", { eventId: "absent" })).toMatchObject({ result: { isError: true, structuredContent: { error: "EventNotFound" } } });
    expect(await call("whoami", { surprise: true })).toMatchObject({ result: { isError: true } });
    expect((await request(undefined, { "mcp-protocol-version": "1900-01-01" })).status).toBe(400);
    expect((await request(undefined, { "content-type": "text/plain" })).status).toBe(415);
    expect((await request(undefined, { "content-length": "9999999" })).status).toBe(413);
    expect(safeError(new Error("postgres password=secret stack trace"))).not.toContain("secret");
  });
  it.each(["", "Bearer invalid", `Bearer det_${"x".repeat(43)}`])("rejects missing/invalid credentials: %s", async authorization => {
    const response = await request(undefined, { authorization }); expect(response.status).toBe(401);
  });
  it("rejects ambient cookies and all browser Origins, including null; Bearer plus cookies uses only Bearer", async () => {
    expect((await request(undefined, { authorization: "", cookie: "__Host-sid=anything" })).status).toBe(401);
    expect((await request(undefined, { cookie: "__Host-sid=anything" })).status).toBe(200);
    for (const origin of ["https://events.didit.me", "https://evil.test", "null"]) expect((await request(undefined, { origin })).status).toBe(403);
  });
  it.each(["revoked", "expired", "disabled", "external"])("rechecks %s tokens or staff on every request", async mode => {
    expect((await request()).status).toBe(200);
    if (mode === "revoked") await q().query("update api_tokens set revoked_at=clock_timestamp()");
    if (mode === "expired") await q().query("update api_tokens set expires_at=clock_timestamp()-interval '1 second'");
    if (mode === "disabled") await q().query("update staff set disabled_at=clock_timestamp()");
    if (mode === "external") { await q().query("insert into staff(email,role) values('outside@example.test','owner')"); await q().query("update api_tokens set staff_email='outside@example.test'"); }
    expect((await request()).status).toBe(mode === "revoked" || mode === "expired" ? 401 : 403);
  });
  it.each(["owner", "admin", "staff"])("enforces per-tool roles for %s", async role => {
    await q().query("update staff set role=$1", [role]);
    for (const tool of toolDefinitions()) {
      const response = await call(tool.name);
      const forbidden = ["OwnerOrAdminRequired", "OwnerRequired"].includes(response.result?.structuredContent?.error);
      expect(forbidden, tool.name).toBe(role === "staff" ? managerTools.includes(tool.name) : role === "admin" && tool.name === "outbox_requeue");
    }
  });
  it("checks revocation again inside mutation services", async () => {
    const actor = await requireStaffByToken(token, undefined, database.db);
    await q().query("update api_tokens set revoked_at=clock_timestamp()");
    await expect(createTools(database.db).call("team_invite", { email: "new@didit.me" }, actor)).rejects.toThrow("StaffForbidden");
    await expect(createTools(database.db).call("event_create", { slug: "denied", name: "Denied", capacity: 2, startsAt: "2099-01-01T00:00:00Z", endsAt: "2099-01-01T01:00:00Z" }, actor)).rejects.toThrow("Forbidden");
  });
  it("rate limits each token independently", async () => {
    await q().query("insert into counters(key,value,expires_at) values($1,120,clock_timestamp()+interval '1 minute')", [`mcp:${tokenId}`]);
    const limited = await request(); expect(limited.status).toBe(429); expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    token = (await bootstrapApiToken("owner@didit.me", "another", database.db)).token;
    expect((await request()).status).toBe(200);
  });
  it.each(["owner", "admin"])("%s lists/revokes every staff token with actor audit and no hashes", async role => {
    expect(token).toMatch(/^det_[A-Za-z0-9_-]{43}$/);
    const [row] = await q().query("select * from api_tokens where id=$1", [tokenId]);
    expect(row!.token_hash).toBe(createHash("sha256").update(token).digest("hex")); expect(JSON.stringify(row)).not.toContain(token);
    expect(new Date(row!.expires_at as Date).getTime() - new Date(row!.created_at as Date).getTime()).toBeCloseTo(365 * 86400000, -3);
    const browser = await testStaffSession(database.db), actor = await browser.requireStaff(browser.cookie), service = createApiTokenService(database.db);
    await q().query("update staff set role=$2 where email=$1", [actor.email, role]);
    const made = await service.create(actor, "browser-client"); expect(await service.list(actor)).toHaveLength(2);
    expect(JSON.stringify(await service.list(actor))).not.toMatch(/token_hash|tokenHash|det_/);
    await service.revoke(actor, tokenId); expect((await request()).status).toBe(401);
    expect(await q().query("select actor from audit where target=$1 and action='api_token.revoked'", [tokenId])).toEqual([{ actor: actor.email }]);
    await service.revoke(actor, made.metadata.id); await service.revoke(actor, made.metadata.id);
    expect(await q().query("select action from audit where target=$1 and action='api_token.revoked'", [made.metadata.id])).toHaveLength(1);
    await expect(requireStaffByToken(made.token, undefined, database.db)).rejects.toThrow("InvalidBearerToken");
    expect(await service.list(actor)).toEqual([]);
    await q().query("update staff set role='staff' where email=$1", [actor.email]);
    await expect(service.create(actor, "denied")).rejects.toThrow("StaffForbidden");
    await expect(service.list(actor)).rejects.toThrow("StaffForbidden");
    await expect(service.revoke(actor, tokenId)).rejects.toThrow("StaffForbidden");
  });
  it("protects owners and rejects non-company bootstrap", async () => {
    await q().query("insert into staff(email,role) values('admin@didit.me','admin'),('outside@example.test','staff')");
    await expect(bootstrapApiToken("outside@example.test", "bad", database.db)).rejects.toThrow("StaffForbidden");
    token = (await bootstrapApiToken("admin@didit.me", "admin", database.db)).token;
    expect(await call("team_invite", { email: "new-owner@didit.me", role: "owner" })).toMatchObject({ result: { isError: true, structuredContent: { error: "OwnerRequired" } } });
    expect(await call("team_disable", { email: "owner@didit.me" })).toMatchObject({ result: { isError: true } });
    expect(await call("team_disable", { email: "admin@didit.me" })).toMatchObject({ result: { isError: true, structuredContent: { error: "CannotDisableSelf" } } });
  });
  it("uses shared calendar validation, saves partial text and clears images", async () => {
    expect(await call("calendar_update", { name: "Founders", xUrl: "https://evil.test" })).toMatchObject({ result: { isError: true } });
    expect(await call("calendar_update", { name: "Founders", websiteUrl: "https://didit.me", logoUrl: null })).toMatchObject({ result: { structuredContent: { name: "Founders", websiteUrl: "https://didit.me/" } } });
    expect(await call("calendar_update", { tagline: "Barcelona" })).toMatchObject({ result: { structuredContent: { name: "Founders", tagline: "Barcelona" } } });
    expect(await call("calendar_update", { name: "Do not save", coverUrl: "https://127.0.0.1/a.png" })).toMatchObject({ result: { isError: true } });
    expect(await call("calendar_get")).toMatchObject({ result: { structuredContent: { name: "Founders" } } });
  });
  it("outbox_requeue: owner only, dry run, code and age filters, idempotent, never a sent or suppressed row; system_status names the trouble", async () => {
    const row = (key: string, status: string, error: string | null, hoursAgo = 2) => q().query(
      `insert into outbox(kind,dedupe_key,payload,status,attempts,error,created_at,failed_at) values('email:M-02',$1,'{"code":"M-02","accountId":"a"}'::jsonb,$2,12,$3,
        clock_timestamp()-$4 * interval '1 hour',case when $2='failed' then clock_timestamp()-$4 * interval '1 hour' end)`, [key, status, error, hoursAgo]);
    await row("quota", "failed", "provider_quota"); await row("exhausted", "failed", "retries_exhausted"); await row("older", "failed", "provider_quota", 72);
    await row("suppressed", "failed", "suppressed_staff"); await row("rejected", "failed", "resend_422"); await row("sent", "sent", null);
    const rows = () => q().query("select dedupe_key,status,attempts,error from outbox order by dedupe_key"), before = await rows();
    expect((await call("system_status")).result.structuredContent.emails).toMatchObject({ pending: [], failed: [{ error: "provider_quota", n: 1 }, { error: "resend_422", n: 1 }, { error: "retries_exhausted", n: 1 }, { error: "suppressed_staff", n: 1 }] });
    for (const role of ["admin", "staff"]) {
      await q().query("update staff set role=$1", [role]);
      expect(await call("outbox_requeue", { dryRun: true })).toMatchObject({ result: { isError: true, structuredContent: { error: "OwnerRequired" } } });
    }
    await q().query("update staff set role='owner'");
    for (const bad of [{ codes: ["suppressed_staff"] }, { codes: ["resend_422"] }, { codes: [] }, { hours: 169 }, { hours: 0 }, { dryRun: "yes" }, { all: true }]) expect(await call("outbox_requeue", bad), JSON.stringify(bad)).toMatchObject({ result: { isError: true } });
    expect(await call("outbox_requeue", { dryRun: true })).toMatchObject({ result: { structuredContent: { dryRun: true, hours: 48, total: 2, counts: { provider_quota: 1, retries_exhausted: 1 }, kinds: { "email:M-02": 2 } } } });
    expect(await rows()).toEqual(before);
    expect(await call("outbox_requeue", { codes: ["provider_quota"] })).toMatchObject({ result: { structuredContent: { dryRun: false, total: 1, counts: { provider_quota: 1 } } } });
    expect(await call("outbox_requeue", { hours: 168 })).toMatchObject({ result: { structuredContent: { total: 2, counts: { provider_quota: 1, retries_exhausted: 1 } } } });
    expect(await call("outbox_requeue", { hours: 168 })).toMatchObject({ result: { structuredContent: { total: 0, counts: {} } } });
    const moved = ["exhausted", "older", "quota"];
    expect(await rows()).toEqual(before.map(r => moved.includes(r.dedupe_key as string) ? { ...r, status: "pending", attempts: 0, error: null } : r));
    expect(await q().query("select actor from audit where action='outbox.requeue'")).toEqual([{ actor: "owner@didit.me" }, { actor: "owner@didit.me" }]);
    expect((await call("system_status")).result.structuredContent.emails).toMatchObject({ pending: [{ error: null, n: 3 }], failed: [{ error: "resend_422", n: 1 }, { error: "suppressed_staff", n: 1 }] });
  });
  it("has no side effects for invalid tool arguments", async () => {
    expect(await call("event_create", { slug: "invalid", name: "Invalid", startsAt: "today" })).toMatchObject({ result: { isError: true } });
    expect(await q().query("select id from events")).toEqual([]);
  });
});

it("team_invite and team_disable accept the configured staff domains (STAFF_EMAIL_DOMAIN), like the Team page", () => {
  const ok = (name: "team_invite" | "team_disable", email: string) => schemas[name].safeParse({ email }).success;
  expect(ok("team_invite", "new@didit.me")).toBe(true);
  expect(ok("team_invite", "new@fork.test")).toBe(false);
  vi.stubEnv("STAFF_EMAIL_DOMAIN", "fork.test, partner.org");
  try {
    for (const name of ["team_invite", "team_disable"] as const) {
      expect(ok(name, "new@fork.test")).toBe(true);
      expect(ok(name, "New@Partner.org")).toBe(true);
      expect(ok(name, "new@didit.me")).toBe(false);
      expect(ok(name, "new@sub.fork.test")).toBe(false);
      expect(ok(name, "new@fork.test.evil.example")).toBe(false);
    }
  } finally { vi.unstubAllEnvs(); }
});

it("tools/list schemas stay identical to Zod input schemas, including required and unknown fields", () => {
  for (const tool of toolDefinitions()) {
    expect(tool.inputSchema).toEqual(z.toJSONSchema(schemas[tool.name], { io: "input" }));
    expect(tool.inputSchema.additionalProperties).toBe(false);
    const properties = tool.inputSchema.properties!;
    const required = tool.inputSchema.required ?? [];
    for (const [name, validator] of Object.entries(schemas[tool.name].shape)) {
      expect(properties).toHaveProperty(name);
      expect(required.includes(name)).toBe(!validator.safeParse(undefined).success);
    }
  }
  expect(schemas.event_create.safeParse({ name: "x", slug: "x", startsAt: "2099-01-01T00:00:00Z", endsAt: "2099-01-01T01:00:00Z", capacity: 10 }).success).toBe(true);
  expect(schemas.event_publish.safeParse({ eventId: randomUUID(), status: "published" }).success).toBe(false);
});

it("blocks private, mapped, reserved and redirect-capable image URL targets before networking", async () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "192.168.0.1", "0.0.0.0", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2002:7f00:1::", "2001:db8::1"]) expect(publicImageAddress(address), address).toBe(false);
  for (const address of ["8.8.8.8", "2606:4700:4700::1111"]) expect(publicImageAddress(address)).toBe(true);
  for (const url of ["http://example.test/a.png", "https://user:secret@example.test/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://8.8.8.8:8443/a.png"]) await expect(downloadImage(url)).rejects.toThrow();
});
