import { accountSession } from "@didit-events/core/testing/account-session";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createIdentityServices } from "@didit-events/core/identity";
import { testDatabase, resetDatabase } from "@didit-events/core/testing/database";
import { queryable } from "@didit-events/core/db/tx";
import { png } from "@didit-events/core/testing/images";
import { csrfToken } from "../../../src/auth/browser";
import { removeCalendarImageAction, saveCalendarAction, uploadCalendarImageAction } from "./actions";
import CalendarAdminPage from "./page";
import { GET as image } from "../../api/calendar/[kind]/route";

// Real identity service, guards and database; only Next's request plumbing and the event list are substituted.
const state = vi.hoisted(() => ({ identity: undefined as ReturnType<typeof createIdentityServices> | undefined, cookie: "", csrf: "", origin: "https://events.didit.me" }));
vi.mock("../../../src/auth/runtime", () => ({ get identity() { return state.identity!; } }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); }, forbidden: () => { throw new Error("FORBIDDEN"); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "__Host-sid" && state.cookie ? { value: state.cookie } : undefined) }),
  headers: async () => new Headers({ origin: state.origin, cookie: `__Host-sid=${state.cookie}; __Host-csrf=${state.csrf}` }),
}));
vi.mock("../../../src/server/b4-views", async (original) => ({ ...(await original<object>()), publishedEvents: async () => [], calendarSubscribers: async () => 12 }));
vi.mock("../../e/[slug]/data", () => ({ getViewer: async () => null }));
vi.mock("../../e/[slug]/actions", () => ({ verifyAction: async () => ({}), subscribeAction: async () => ({}) }));

const secret = "calendar-profile-fixture-secret-over-32-characters", origin = "https://events.didit.me";
const values = { name: "Founders Club BCN", tagline: "Dinners for builders", description: "Monthly dinners in Barcelona.\nBring a friend.", websiteUrl: "https://didit.me/events", xUrl: "https://x.com/didit", linkedinUrl: "" };

describe("/admin/calendar", () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  const q = () => queryable(database.db);
  beforeAll(async () => {
    database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite");
    (globalThis as typeof globalThis & { __diditEventsDb?: typeof database.db }).__diditEventsDb = database.db;
  }, 60_000);
  beforeEach(async () => {
    await resetDatabase(database.db);
    state.identity = createIdentityServices({ db: database.db, secret, appUrl: origin });
    state.cookie = ""; state.csrf = ""; state.origin = origin;
    vi.stubEnv("APP_URL", origin); vi.stubEnv("SESSION_SECRET", secret);
    await q().query("insert into staff(email,role) values('owner@didit.me','owner'),('admin@didit.me','admin'),('staff@didit.me','staff')");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    delete (globalThis as typeof globalThis & { __diditEventsDb?: typeof database.db }).__diditEventsDb;
    await database?.close();
  });
  async function login(role: "owner" | "admin" | "staff") {
    const result = await accountSession(state.identity!, database.db, `${role}@didit.me`);
    state.cookie = result.cookie; state.csrf = csrfToken(result.cookie, secret);
  }
  const form = (fields: Record<string, string | Blob>, csrf: string | null = state.csrf) => {
    const f = new FormData();
    if (csrf !== null) f.set("csrf", csrf);
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const save = (fields: Record<string, string> = values, csrf?: string | null) => saveCalendarAction({ status: "idle", values }, form(fields, csrf));
  const upload = (kind: "cover" | "logo", blob: Blob) => uploadCalendarImageAction(kind, {}, form({ image: blob }));
  const publicHtml = async () => {
    const EventsRoute = (await import("../../events/page")).default;
    const { generateMetadata } = await import("../../events/page");
    const Home = (await import("../../(home)/page")).default;
    const events = renderToStaticMarkup(await EventsRoute({ searchParams: Promise.resolve({}) }));
    const home = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    return { events, home, metadata: await generateMetadata() };
  };
  const rows = () => q().query("select name,tagline,cover_type,logo_type from calendar_profiles");

  it("no profile row: the public page renders the built-in Didit header exactly as before", async () => {
    const { events, home, metadata } = await publicHtml();
    for (const html of [events, home]) {
      expect(html).toContain("<h1");
      expect(html).toContain(">Didit Events</h1>");
      expect(html).toContain("Evenings for founders, operators and fraud teams in Barcelona, San Francisco and beyond. Every door runs on Didit face check-in.");
      expect(html).toMatch(/background-image:url\([^)]*bg-aqua[^)]*\)/);
      expect(html).toContain("didit-mark");
      expect(html).not.toContain("/api/calendar/");
      expect(html).not.toContain("Identity, fraud and founders");
      expect(html).not.toContain('aria-label="Links"');
    }
    expect(metadata).toMatchObject({ title: "Didit Events", description: expect.stringContaining("Every door runs on Didit face check-in.") });
  });

  it("an owner's edits (text, links, cover, logo) change /events and / and their metadata", async () => {
    await login("owner");
    expect(await save()).toMatchObject({ status: "saved" });
    expect(await upload("cover", new Blob([png(1760, 400)], { type: "image/png" }))).toEqual({ saved: true });
    await login("admin");
    expect(await upload("logo", new Blob([png(512, 512)], { type: "image/png" }))).toEqual({ saved: true });
    const { events, home, metadata } = await publicHtml();
    for (const html of [events, home]) {
      expect(html).toContain(">Founders Club BCN</h1>");
      expect(html).toContain("Dinners for builders");
      expect(html).toContain("Monthly dinners in Barcelona.");
      expect(html).toContain("url(/api/calendar/cover?v=1)");
      expect(html).toContain('src="/api/calendar/logo?v=1"');
      expect(html).toContain('href="https://didit.me/events"');
      expect(html).toContain('href="https://x.com/didit"');
      // The profile has no LinkedIn link (the site footer keeps Didit's own).
      expect(html.match(/<ul class="links" aria-label="Links">.*?<\/ul>/)![0]).not.toContain("LinkedIn");
    }
    expect(metadata).toMatchObject({ title: "Founders Club BCN", description: "Monthly dinners in Barcelona.\nBring a friend.", openGraph: { images: [{ url: "/api/calendar/cover?v=1" }] } });
    const [row] = await q().query<{ updated_by: string }>("select updated_by from calendar_profiles");
    expect(row!.updated_by).toBe("admin@didit.me");

    const res = await image(new Request("https://events.didit.me/api/calendar/cover?v=1"), { params: Promise.resolve({ kind: "cover" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png(1760, 400));
    const stale = await image(new Request("https://events.didit.me/api/calendar/cover?v=0"), { params: Promise.resolve({ kind: "cover" }) });
    expect(stale.headers.get("cache-control")).toBe("public, max-age=60");
    expect((await image(new Request("https://events.didit.me/api/calendar/nope"), { params: Promise.resolve({ kind: "nope" }) })).status).toBe(404);

    await login("owner");
    expect(await removeCalendarImageAction("cover", {}, form({}))).toEqual({ removed: true });
    const after = await publicHtml();
    expect(after.events).toMatch(/background-image:url\([^)]*bg-aqua[^)]*\)/);
    expect((await image(new Request("https://events.didit.me/api/calendar/cover?v=2"), { params: Promise.resolve({ kind: "cover" }) })).status).toBe(404);
  });

  it("the image action rejects non-images, wrong types, bad sizes and files over 5 MB", async () => {
    await login("owner");
    expect(await upload("cover", new Blob([new TextEncoder().encode("<svg/>")], { type: "image/svg+xml" }))).toEqual({ error: "That file is not a JPG, PNG or WebP image." });
    expect(await upload("cover", new Blob([new Uint8Array(4096)], { type: "image/png" }))).toEqual({ error: "That file is not a JPG, PNG or WebP image." });
    expect(await upload("cover", new Blob([png(200, 50)], { type: "image/png" }))).toEqual({ error: "That image is too small or too large. Use the recommended size." });
    expect(await upload("logo", new Blob([png(2000, 200)], { type: "image/png" }))).toEqual({ error: "That image is too small or too large. Use the recommended size." });
    expect(await upload("cover", new Blob([png(1760, 400), new Uint8Array(5 * 1024 * 1024)], { type: "image/png" }))).toEqual({ error: "Use an image under 5 MB." });
    const cover = png(1760, 400), truncated = new Uint8Array([...cover.subarray(0, 33), 0, 0, 0x10, 0, ...[..."tEXt"].map(c => c.charCodeAt(0)), 65, 0, 66]);
    expect(await upload("cover", new Blob([truncated], { type: "image/png" }))).toEqual({ error: "We couldn't read that image. Try another JPG or PNG" });
    expect(await rows()).toEqual([]);
  });

  it("field rules are enforced on the server (same module as the client)", async () => {
    await login("owner");
    const result = await save({ ...values, name: "  ", websiteUrl: "http://didit.me", xUrl: "https://evil.example/didit", description: "x".repeat(601) });
    expect(result).toMatchObject({ status: "invalid", errors: { name: "Give the calendar a name", websiteUrl: "Use a full link starting with https://", xUrl: "Use an x.com link", description: "Keep the bio under 600 characters" } });
    expect(await rows()).toEqual([]);
  });

  it("anonymous and staff-role users cannot save or upload; CSRF is required", async () => {
    await expect(save()).rejects.toThrow("REDIRECT:/login?next=%2Fadmin%2Fcalendar");
    await login("staff");
    // Signed in but not owner/admin: the 403 response (capability calendar.edit), never a login loop.
    await expect(save()).rejects.toThrow("FORBIDDEN");
    await expect(upload("cover", new Blob([png(1760, 400)], { type: "image/png" }))).rejects.toThrow("FORBIDDEN");
    await expect(removeCalendarImageAction("logo", {}, form({}))).rejects.toThrow("FORBIDDEN");
    // Staff reach the page but get the 403 view, never the form.
    const html = renderToStaticMarkup(await CalendarAdminPage());
    expect(html).toContain("403");
    expect(html).toContain("Owners and admins only");
    expect(html).not.toContain("Save calendar");
    await login("owner");
    await expect(save(values, null)).rejects.toMatchObject({ status: 403 });
    await expect(save(values, "forged")).rejects.toMatchObject({ status: 403 });
    expect(await rows()).toEqual([]);
    const owner = renderToStaticMarkup(await CalendarAdminPage());
    expect(owner).toContain("Save calendar");
    expect(owner).toContain('value="Didit Events"');
  });
});
