import { accountSession } from "@didit-events/core/testing/account-session";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createIdentityServices } from "@didit-events/core/identity";
import { renderToStaticMarkup } from "react-dom/server";
import { queryable } from "@didit-events/core/db/tx";
import { skipPostgres } from "@didit-events/core/testing/postgres";
import { adminTestDatabase } from "../../../../../src/admin/testing/database";
import { getEvent, getEventHeader, getEventTimeZone, resolveEventId } from "./data";
import OverviewPage from "./(tabs)/(overview)/page";
import GuestsPage from "./(tabs)/guests/page";
import ApplicantsPage from "./(tabs)/applicants/page";
import SettingsPage from "./(tabs)/settings/page";
import LogPage from "./(tabs)/log/page";
import EditPage from "./edit/page";
import EventLayout from "./(tabs)/layout";

const browser = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => key === "__Host-sid" ? { value: browser.cookie } : undefined }) }));
const pages = [
  ["overview", OverviewPage, "bcn-opening"], ["guests", GuestsPage, "bcn-opening"],
  ["applicants", ApplicantsPage, "ai-era"], ["settings", SettingsPage, "bcn-opening"],
  ["log", LogPage, "bcn-opening"], ["edit", EditPage, "bcn-opening"],
] as const;
const params = (id: string) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
const missing = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

for (const kind of ["pglite", "postgres"] as const) describe.skipIf(kind === "postgres" && skipPostgres)(`admin event resolution (${kind})`, () => {
  let database: Awaited<ReturnType<typeof adminTestDatabase>>;
  beforeAll(async () => { database = await adminTestDatabase(["bcn-opening", "ai-era"], kind);
    const secret = "admin-render-test-secret-longer-than-32-characters"; vi.stubEnv("SESSION_SECRET", secret);
    await queryable(database.db).query("insert into staff(email,role) values('render@didit.me','owner')");
    browser.cookie = (await accountSession(createIdentityServices({ db: database.db, secret }), database.db, "render@didit.me")).cookie; }, 60_000);
  afterAll(async () => { await database?.close(); vi.unstubAllEnvs(); });

  it.each(pages)("%s renders the same tab via stored slug and UUID", async (_name, page, slug) => {
    const uuid = database.ids.get(slug)!;
    expect(renderToStaticMarkup(await page(params(uuid)))).toBe(renderToStaticMarkup(await page(params(slug))));
    expect(await resolveEventId(slug)).toBe(uuid);
    expect(await getEventHeader(uuid)).toEqual(await getEventHeader(slug));
    expect(await getEventTimeZone(uuid)).toBe(await getEventTimeZone(slug));
  });

  it.each(["unknown", "00000000-0000-0000-0000-000000000000", "-".repeat(36), "g".repeat(36), "../bad", ""])("all consumers return a clean 404 for %j without a parent layout", async id => {
    expect(await getEvent(id)).toBeNull();
    expect(await getEventHeader(id)).toBeNull();
    expect(await resolveEventId(id)).toBeNull();
    await expect(getEventTimeZone(id)).rejects.toMatchObject(missing);
    await expect(EventLayout({ ...params(id), children: null })).rejects.toMatchObject(missing);
    for (const [, page] of pages) await expect(page(params(id))).rejects.toMatchObject(missing);
  });

  it("header request count, registration state and timezone come from the database", async () => {
    const id = database.ids.get("ai-era")!, q = queryable(database.db);
    await q.query(`update events set status='published', starts_at=clock_timestamp()+interval '1 day',
      ends_at=clock_timestamp()+interval '2 days', capacity=1, timezone='America/New_York' where id=$1`, [id]);
    expect(await getEventHeader(id)).toMatchObject({ guestCount: 1, requestCount: 0, registration: "full", mode: "request" });
    await q.query("update registrations set admission='pending' where event_id=$1", [id]);
    expect(await getEventHeader("ai-era")).toMatchObject({ guestCount: 0, requestCount: 1, registration: "open" });
    expect(await getEventTimeZone("ai-era")).toBe("America/New_York");
    await q.query("update events set form=jsonb_set(form,'{closes_at}',$2::jsonb) where id=$1", [id,JSON.stringify(new Date(Date.now()-1000).toISOString())]);
    expect(await getEventHeader(id)).toMatchObject({ registration: "closed" });
  });
});
