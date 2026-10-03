import type * as CalendarData from "../../app/events/data";
vi.mock("../server/b4-policy", () => ({ guardAction: async () => {}, staffViewer: async () => null }));
vi.mock("../../app/e/[slug]/data", () => import("./route-fixtures"));
vi.mock("../../app/events/data", async original => {
 const real = await original<typeof CalendarData>();
 const { CALENDAR } = await import("./fixtures");
 return { ...real, getViewer: async () => null, getProfile: async () => CALENDAR, getCalendar: async (tab: "upcoming" | "past", now: Date) => ({ calendar: CALENDAR, events: real.calendarTab(CALENDAR.events, tab, now) }) };
});
// Component-only examples stay in the test seam, never real route loaders.
vi.mock("../../app/e/[slug]/v/[token]/data", async () => {
  const { findEvent } = await import("./fixtures");
  const states: Record<string, string> = { demo: "valid", "demo-expired": "expired", "demo-revoked": "revoked", "demo-verified": "verified", "demo-in-review": "in_review" };
  return { getInvite: async (slug: string, token: string) => process.env.NODE_ENV !== "production" && states[token] && findEvent(slug) ? { state: states[token], event: findEvent(slug), firstName: "Maria" } : null,
    verificationUrlForLink: async (slug: string, token: string) => token === "demo" ? { url: `/e/${slug}/done?session=demo-approved` } : null };
});
vi.mock("../../app/e/[slug]/done/data", async () => {
  const { findEvent } = await import("./fixtures");
  const states: Record<string, string> = { "demo-approved": "approved", "demo-in-review": "in_review", "demo-declined": "declined", "demo-not-finished": "not_finished" };
  return { getOutcome: async (slug: string, session: string) => states[session] && findEvent(slug) ? { state: states[session], event: findEvent(slug), attemptsLeft: 1 } : null };
});
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anonymousCsrf, anonymousHeaders, testOrigin, testSecret } from "../auth/testing-browser";

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/navigation", () => nav);
vi.mock("next/headers", () => ({ headers: async () => anonymousHeaders() }));
beforeEach(() => { vi.stubEnv("APP_URL", testOrigin); vi.stubEnv("SESSION_SECRET", testSecret); });

const EventRoute = (await import("../../app/e/[slug]/page")).default;
const InviteRoute = (await import("../../app/e/[slug]/v/[token]/page")).default;
const DoneRoute = (await import("../../app/e/[slug]/done/page")).default;
const EventsRoute = (await import("../../app/events/page")).default;
const { GET: ics } = await import("../../app/e/[slug]/event.ics/route");
const { verifyAction, subscribeAction } = await import("../../app/e/[slug]/actions");
const { startFromLinkAction } = await import("../../app/e/[slug]/v/[token]/actions");

const p = <T,>(v: T) => Promise.resolve(v);
const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  f.set("csrf", anonymousCsrf);
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/e/[slug]", () => {
  it("feature event renders P-01 with the card for this viewer", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T12:00:00+02:00"), toFake: ["Date"] });
    const out = await html(EventRoute({ params: p({ slug: "ai-era" }), searchParams: p({}) }));
    expect(out).toContain("Building, Raising & Scaling in the");
    expect(out).toContain('data-card="signed_out"');
    expect(out).toContain("Thursday, 8 October");
  });

  it("?preview reaches every P-02 state in dev/test, and is ignored in production", async () => {
    const going = await html(EventRoute({ params: p({ slug: "ai-era" }), searchParams: p({ preview: "P-02f" }) }));
    expect(going).toContain('data-card="going"');
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRAMES", "");
    const prod = await html(EventRoute({ params: p({ slug: "ai-era" }), searchParams: p({ preview: "P-02f" }) }));
    expect(prod).not.toContain('data-card="going"');
  });

  it("simple event renders the G-01 form while open, the G-01 message once closed", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T12:00:00+02:00"), toFake: ["Date"] });
    expect(await html(EventRoute({ params: p({ slug: "barcelona-office-opening" }), searchParams: p({}) }))).toContain("Request to attend");
    const ended = await html(EventRoute({ params: p({ slug: "barcelona-office-opening" }), searchParams: p({ preview: "ended" }) }));
    expect(ended).toContain("This event has ended");
  });

  it("unknown slug → not found (G-01i)", async () => {
    await expect(EventRoute({ params: p({ slug: "nope" }), searchParams: p({}) })).rejects.toThrow("404");
  });

  it("serves an .ics", async () => {
    const res = await ics(new Request("https://events.didit.me/e/ai-era/event.ics"), { params: p({ slug: "ai-era" }) });
    expect(res.headers.get("content-type")).toContain("text/calendar");
    expect(await res.text()).toContain("BEGIN:VEVENT");
    expect((await ics(new Request("https://x/e/nope/event.ics"), { params: p({ slug: "nope" }) })).status).toBe(404);
  });

  it("verify and subscribe send a signed-out guest to sign in", async () => {
    await expect(verifyAction(fd({ slug: "ai-era" }))).rejects.toThrow("NEXT_REDIRECT;/login?next=%2Fe%2Fai-era");
    await expect(subscribeAction(fd({ slug: "ai-era" }))).rejects.toThrow("NEXT_REDIRECT;/login?next=%2Fe%2Fai-era");
  });
});

describe("/e/[slug]/v/[token] (G-02)", () => {
  it("pending starts render the retry form on both entry routes, while dead links stay closed", async () => {
    const link = await html(InviteRoute({ params: p({ slug: "barcelona-office-opening", token: "demo" }), searchParams: p({ preparing: "attempt-1" }) }));
    expect(link).toContain("Preparing your verification…");
    expect(link).toContain('name="csrf"'); expect(link).toContain('name="token" value="demo"');
    expect(link).toContain('role="status"'); expect(link).toContain("Try again");
    const event = await html(EventRoute({ params: p({ slug: "ai-era" }), searchParams: p({ preparing: "attempt-2" }) }));
    expect(event).toContain("Preparing your verification…"); expect(event).toContain('name="slug" value="ai-era"');
    const expired = await html(InviteRoute({ params: p({ slug: "barcelona-office-opening", token: "demo-expired" }), searchParams: p({ preparing: "attempt-3" }) }));
    expect(expired).toContain("This link has expired"); expect(expired).not.toContain("Preparing your verification…");
  });

  it.each([
    ["demo", "Start verification"],
    ["demo-expired", "This link has expired"],
    ["demo-revoked", "This invite is no longer active"],
    ["demo-verified", "You’re all set"],
    ["demo-in-review", "We’re checking your verification"],
  ])("%s", async (token, text) => {
    expect(await html(InviteRoute({ params: p({ slug: "barcelona-office-opening", token }) }))).toContain(text);
  });

  it("unknown or production tokens 404 until link_tokens is wired", async () => {
    await expect(InviteRoute({ params: p({ slug: "barcelona-office-opening", token: "nope" }) })).rejects.toThrow("404");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRAMES", "");
    await expect(InviteRoute({ params: p({ slug: "barcelona-office-opening", token: "demo" }) })).rejects.toThrow("404");
  });

  it("Start verification redirects valid links to Didit and re-renders dead ones", async () => {
    await expect(startFromLinkAction(fd({ slug: "barcelona-office-opening", token: "demo" }))).rejects.toThrow("NEXT_REDIRECT;/e/barcelona-office-opening/done");
    await expect(startFromLinkAction(fd({ slug: "barcelona-office-opening", token: "demo-expired" }))).rejects.toThrow(
      "NEXT_REDIRECT;/e/barcelona-office-opening/v/demo-expired",
    );
  });
});

describe("/e/[slug]/done (G-03)", () => {
  it.each([
    ["demo-approved", "You’re verified"],
    ["demo-in-review", "We’re checking your verification"],
    ["demo-declined", "We couldn’t verify you"],
    ["demo-not-finished", "You haven’t finished"],
  ])("%s", async (session, text) => {
    const out = await html(DoneRoute({ params: p({ slug: "barcelona-office-opening" }), searchParams: p({ verificationSessionId: session }) }));
    expect(out).toContain(text);
  });

  it("approved offers Google Calendar and .ics", async () => {
    const out = await html(DoneRoute({ params: p({ slug: "barcelona-office-opening" }), searchParams: p({ session: "demo-approved" }) }));
    expect(out).toContain("https://calendar.google.com/calendar/render?");
    expect(out).toContain('href="/e/barcelona-office-opening/event.ics"');
  });

  it("no session → not found", async () => {
    await expect(DoneRoute({ params: p({ slug: "barcelona-office-opening" }), searchParams: p({}) })).rejects.toThrow("404");
  });
});

describe("/events (P-03)", () => {
  it("upcoming by default, past with ?when=past", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T17:30:00+02:00"), toFake: ["Date"] });
    const up = await html(EventsRoute({ searchParams: p({}) }));
    expect(up).toContain("84 going · approval required");
    expect(up).toContain("Invite only");
    expect(up).toMatch(/aria-current="page"[^>]*>Upcoming/);
    const past = await html(EventsRoute({ searchParams: p({ when: "past" }) }));
    expect(past).toContain("71 attended");
    expect(past).toMatch(/aria-current="page"[^>]*>Past/);
  });

  it("empty tab shows the empty state", async () => {
    vi.useFakeTimers({ now: new Date("2027-06-01T00:00:00Z"), toFake: ["Date"] });
    expect(await html(EventsRoute({ searchParams: p({}) }))).toContain("No upcoming events");
  });
});
