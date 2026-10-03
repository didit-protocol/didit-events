import { afterEach, describe, expect, it, vi } from "vitest";
import { apiCall } from "./api-client";

const reply = (status: number, body: unknown, json = true) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(json ? JSON.stringify(body) : String(body), { status, headers: { "content-type": json ? "application/json" : "text/html" } })));
const call = () => apiCall<{ id: string }>("/api/x", { method: "POST", body: "{}" }, () => "tok");

afterEach(() => vi.unstubAllGlobals());

describe("apiCall: the status decides, only contract bodies pass", () => {
  it("2xx with the success envelope → ok with data", async () => {
    reply(200, { ok: true, data: { id: "r1" } });
    expect(await call()).toEqual({ ok: true, data: { id: "r1" } });
    reply(201, { ok: true, data: { id: "r2" } });
    expect(await call()).toEqual({ ok: true, data: { id: "r2" } });
  });

  it("2xx without the envelope (a bare object, ok:false, no data, HTML) → typed error, never passed through", async () => {
    for (const body of [{ id: "r1" }, { ok: true }, { ok: false, error: { code: "invalid", message: "x" } }, null, [1]]) {
      reply(200, body);
      const res = await call();
      expect(res.ok, JSON.stringify(body)).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("provider_unavailable");
    }
    reply(200, "<html>", false);
    expect(await call()).toMatchObject({ ok: false, error: { code: "provider_unavailable" } });
  });

  it("non-2xx with a contract error → passed through (fields and context kept)", async () => {
    const error = { code: "invalid", message: "Check your answers.", fields: { why: "Too short" } };
    reply(422, { ok: false, error });
    expect(await call()).toEqual({ ok: false, error });
  });

  it("non-2xx claiming success, or an unknown error shape/code → mapped from the status", async () => {
    reply(500, { ok: true, data: { id: "r1" } });
    expect(await call()).toMatchObject({ ok: false, error: { code: "provider_unavailable" } });
    reply(401, { ok: false, error: { code: "session_gone", message: "x" } });
    expect(await call()).toMatchObject({ ok: false, error: { code: "unauthenticated" } });
    reply(403, { error: "nope" });
    expect(await call()).toMatchObject({ ok: false, error: { code: "forbidden" } });
    reply(404, "Not found", false);
    expect(await call()).toMatchObject({ ok: false, error: { code: "not_found" } });
    reply(429, { ok: false, error: { code: "rate_limited" } });
    expect(await call()).toMatchObject({ ok: false, error: { code: "rate_limited", message: "Something went wrong. Try again in a moment." } });
  });

  it("offline → a recoverable provider_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await call()).toMatchObject({ ok: false, error: { code: "provider_unavailable", message: expect.stringContaining("offline") } });
  });

  it("sends the CSRF token on writes only, same-origin and no-store", async () => {
    reply(200, { ok: true, data: { id: "r1" } });
    await call();
    const init = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store", headers: { "x-csrf": "tok", "content-type": "application/json" } });
  });
});

it.each(["/me/reauth", "https://evil.test", "/admin"])("only follows the fixed re-proof destination (%s)", async destination => {
  const assign = vi.fn(); vi.stubGlobal("window", { location: { assign } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "unauthenticated", message: "Confirm your email." } }), { status: 401, headers: { "x-account-reproof": destination } })));
  await call();
  expect(assign.mock.calls).toEqual(destination === "/me/reauth" ? [["/me/reauth"]] : []);
});
