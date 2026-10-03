import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@didit-events/core/db";
import { queryable } from "@didit-events/core/db/tx";
import { COOKIE_NAMES } from "@didit-events/core/http/policy";
import { IdentityError } from "@didit-events/core/identity";
import { seed, testDatabase } from "@didit-events/core/testing/database";
import { AdminShell, adminMenuItems } from "../../../src/admin/shell/AdminShell";
import type { StaffUser } from "../../../src/admin/types";
import PeopleLayout from "./layout";
import PeoplePage from "./page";
import { getPerson, listPeople } from "./data";
import { GET as photo } from "../../api/admin/people/[accountId]/photo/route";
import { parsePeopleQuery } from "../../../src/admin/people/query";

/*
 * People is owner-only (`people.view`). Every entrypoint — the layout, the page, both loaders and the photo API —
 * refuses admin, staff, host, operator and a plain guest; the owner gets the page.
 */

type Who = { kind: "staff"; role: "owner" | "admin" | "staff"; email: string } | { kind: "guest"; accountId: string; email: string };
const state = vi.hoisted(() => ({ cookie: "", sessions: new Map<string, unknown>() }));
vi.mock("../../../src/auth/runtime", () => ({
  identity: {
    auth: {
      requireStaff: async (cookie: string) => {
        const who = state.sessions.get(cookie) as Who | undefined;
        if (!who) throw new IdentityError("StaffSessionRequired", 401);
        if (who.kind !== "staff") throw new IdentityError("StaffForbidden", 403);
        return { principal: "staff", email: who.email, role: who.role, sessionId: cookie };
      },
      requireGuest: async (cookie: string) => {
        const who = state.sessions.get(cookie) as Who | undefined;
        if (!who || who.kind !== "guest") throw new IdentityError("GuestSessionRequired", 401);
        return { principal: "guest", accountId: who.accountId, sessionId: cookie, authenticatedAt: new Date() };
      },
    },
    accounts: {
      get: async (id: string) => {
        const who = [...state.sessions.values()].find((w) => (w as Who).kind === "guest" && (w as { accountId: string }).accountId === id) as Who | undefined;
        return who ? { id, email: who.email, firstName: null, lastName: null, photoUrl: null, updatedAt: new Date() } : null;
      },
    },
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "__Host-sid" && state.cookie ? { value: state.cookie } : undefined) }), headers: async () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  forbidden: () => { throw new Error("HTTP:403"); },
  notFound: () => { throw new Error("HTTP:404"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@didit-events/core/status", () => ({ operationalStatus: async () => ({ diditApi: "ok" }) }));

let database: Awaited<ReturnType<typeof testDatabase>>, accountId: string;
const globalDb = globalThis as typeof globalThis & { __diditEventsDb?: Db };
const REFUSED = ["admin", "staff", "host", "operator", "guest"] as const;

beforeAll(async () => {
  database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite");
  globalDb.__diditEventsDb = database.db;
  const q = queryable(database.db), { eventId, accountId: seeded } = await seed(database.db);
  accountId = seeded;
  await q.query("update accounts set photo=$2 where id=$1", [accountId, Buffer.from([0xff, 0xd8, 0xff, 0xd9])]);
  const member = async (name: string, role?: "host" | "operator") => {
    const id = randomUUID(), email = `${name}@example.test`;
    await q.query("insert into accounts(id,email) values($1,$2)", [id, email]);
    if (role) await q.query("insert into event_members(event_id,email,role,invited_by) values($1,$2,$3,'owner@didit.me')", [eventId, email, role]);
    state.sessions.set(name, { kind: "guest", accountId: id, email } satisfies Who);
  };
  for (const role of ["owner", "admin", "staff"] as const) state.sessions.set(role, { kind: "staff", role, email: `${role}@didit.me` } satisfies Who);
  await member("host", "host");
  await member("operator", "operator");
  await member("guest");
}, 60_000);
afterAll(async () => { delete globalDb.__diditEventsDb; await database?.close(); });
beforeEach(() => { state.cookie = ""; vi.stubEnv("APP_URL", "https://events.test"); });

const as = (who: string) => { state.cookie = who; };
/** The admin's 403: forbidden() for admin users without the capability, the forbidden page for a plain guest. */
const refusedWith = (who: string) => (who === "guest" ? /REDIRECT:\/admin\/forbidden/ : /HTTP:403/);
const request = (who: string, id = accountId) => photo(new Request(`https://events.test/api/admin/people/${id}/photo`, { headers: { cookie: `${COOKIE_NAMES.session}=${who}` } }), { params: Promise.resolve({ accountId: id }) });

describe("people.view: owner only", () => {
  it("the owner gets the layout (People in the sidebar), the page, both loaders and the photo", async () => {
    as("owner");
    const layout = renderToStaticMarkup(await PeopleLayout({ children: "people-body" }));
    expect(layout).toContain("people-body");
    expect(layout).toMatch(/<a(?=[^>]*href="\/admin\/people")(?=[^>]*aria-current="page")/);
    const page = renderToStaticMarkup(await PeoplePage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain(">People</h1>");
    expect(page).toContain(`${accountId}@example.test`);
    expect((await listPeople(parsePeopleQuery({}))).counts.all).toBe(4);
    expect((await getPerson(accountId))?.email).toBe(`${accountId}@example.test`);
    const response = await request("owner");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await request("owner", randomUUID())).status).toBe(404);
  });

  it.each(REFUSED.map((who) => [who]))("%s is refused by the layout, the page and both loaders", async (who) => {
    as(who);
    await expect(PeopleLayout({ children: "x" })).rejects.toThrow(refusedWith(who));
    await expect(PeoplePage({ searchParams: Promise.resolve({ person: accountId }) })).rejects.toThrow(refusedWith(who));
    await expect(listPeople(parsePeopleQuery({}))).rejects.toThrow(refusedWith(who));
    await expect(getPerson(accountId)).rejects.toThrow(refusedWith(who));
  });

  it.each(REFUSED.map((who) => [who]))("%s gets 403 from the photo API", async (who) => {
    const response = await request(who);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("signed out: the page goes to sign-in and the API answers 401", async () => {
    await expect(PeoplePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/REDIRECT:\/login\?next=%2Fadmin%2Fpeople/);
    expect((await request("nobody")).status).toBe(401);
  });

  it("the sidebar and the phone menu list People only for owners", () => {
    const user = (role: StaffUser["role"], member?: StaffUser["member"]): StaffUser => ({ name: role, email: `${role}@didit.me`, initials: "AB", role, member });
    const shell = (u: StaffUser) => renderToStaticMarkup(<AdminShell active="events" user={u}>x</AdminShell>);
    // The phone menu is the header's avatar menu: its items come from adminMenuItems (closed until tapped).
    const phone = (u: StaffUser) => adminMenuItems(u).map((i) => i.href);
    expect(shell(user("owner")).match(/href="\/admin\/people"/g)).toHaveLength(1);
    expect(phone(user("owner"))).toContain("/admin/people");
    for (const u of [user("admin"), user("staff"), user("staff", "host"), user("staff", "operator")]) {
      expect(shell(u)).not.toContain("/admin/people");
      expect(phone(u)).not.toContain("/admin/people");
    }
  });
});
