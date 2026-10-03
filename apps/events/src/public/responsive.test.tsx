import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginFlow } from "../accounts/components/LoginFlow";
import { GuestScreen } from "../accounts/components/Screen";
import { FlowSkeleton } from "../accounts/components/Skeletons";
import type { SignInStep } from "../accounts/types";
import { COVER_WIDTHS } from "@didit-events/core/content/event-assets";
import { CalendarPage } from "./components/CalendarPage";
import { EventPage } from "./components/EventPage";
import { EventNotFound, GateMessage, InviteMessage, OutcomeMessage } from "./components/Messages";
import { AI_ERA, CALENDAR, MARIA } from "./fixtures";
import { coverAt, heroCoverSrcSet } from "./photos";
import type { PublicEvent } from "./types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

const noop = async () => {};
const actions = { verify: noop, subscribe: noop };
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const count = (out: string, needle: string) => out.split(needle).length - 1;
const css = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const eventPage = (event: PublicEvent, viewer: typeof MARIA | null = null) =>
  html(<EventPage event={event} related={[AI_ERA]} viewer={viewer} card={{ kind: "signed_out" }} now={new Date("2026-10-01T10:00:00Z")} actions={actions} />);

describe("v7 responsive pass: public event page", () => {
  it("the phone layout offers what the desktop side rail does (contact, report); no footer, no Subscribe, no email shown", () => {
    const out = eventPage(AI_ERA);
    // Both layouts are rendered (a container query picks one): each block appears once per layout.
    for (const needle of [">Contact the hosts<", ">Report event<"]) expect(count(out, needle), needle).toBe(2);
    const mobile = out.slice(out.indexOf('class="mobile"'));
    expect(mobile).toContain(">Presented by</h2>");
    for (const gone of ["<footer", ">Subscribe<", "@didit.me<"]) expect(out, gone).not.toContain(gone);
  });

  it("an event without a description has no About section in either layout", () => {
    expect(count(eventPage(AI_ERA), ">About event</h2>")).toBe(2);
    expect(eventPage({ ...AI_ERA, descriptionHtml: undefined, about: [] })).not.toContain("About event");
    expect(eventPage({ ...AI_ERA, descriptionHtml: "  ", about: [" "] })).not.toContain("About event");
  });

  // Round 3: the cover is served width-limited (&w=), with one srcset/sizes for both layouts and one high-priority copy.
  it("an uploaded cover is a width-limited image, one candidate URL for both layouts; thumbnails and the map load lazily", () => {
    const src = "/api/events/1/cover?v=2";
    const withCover = { ...AI_ERA, cover: { ...AI_ERA.cover, src } };
    const out = html(<EventPage event={withCover} related={[withCover]} viewer={null} card={{ kind: "signed_out" }} now={new Date("2026-10-01T10:00:00Z")} actions={actions} />);
    const imgs = out.match(/<img[^>]*src="\/api\/events\/1\/cover\?v=2[^"]*"[^>]*>/g) ?? [];
    // The original (up to 4096px) is never an <img> on the page.
    expect(imgs.length).toBeGreaterThanOrEqual(4);
    for (const img of imgs) expect(img).toMatch(/src="\/api\/events\/1\/cover\?v=2&amp;w=(192|720|1080)"/);
    const hero = imgs.filter((c) => c.includes("srcSet="));
    expect(hero).toHaveLength(2);
    // Same src, srcset and sizes in both layouts: they resolve to one URL, so the hidden layout costs no second download.
    const pick = (img: string, attr: string) => new RegExp(` ${attr}="([^"]*)"`).exec(img)?.[1];
    for (const attr of ["src", "srcSet", "sizes"]) expect(pick(hero[0]!, attr)).toBe(pick(hero[1]!, attr));
    expect(pick(hero[0]!, "srcSet")).toBe(`${src}&amp;w=720 720w, ${src}&amp;w=1080 1080w`);
    expect(pick(hero[0]!, "sizes")).toBe("(max-width: 767px) min(480px, calc(100vw - 32px)), 330px");
    for (const c of hero) expect(c).toMatch(/width="1080" height="1080"/);
    for (const c of hero) expect(c).toContain('loading="eager"');
    expect(hero.filter((c) => c.includes('fetchPriority="high"'))).toHaveLength(1);
    for (const c of imgs.filter((x) => !hero.includes(x))) expect(c).toContain('loading="lazy"');
    expect(out).not.toContain("background-image"); // no CSS-background photos left on the page
  });

  it("the map embed is not in the server HTML twice: each layout holds a placeholder and mounts its embed when displayed", () => {
    const out = eventPage(AI_ERA);
    expect(count(out, "data-venue-map-pending")).toBe(2);
    // The only iframes in the markup are the no-JavaScript fallbacks.
    expect(count(out.replace(/<noscript>.*?<\/noscript>/g, ""), "<iframe")).toBe(0);
    expect(count(out, "<noscript><iframe")).toBe(2);
  });

  it("phone cover steps never exceed the column (width − 32px) from 320px up; tablets get a 260px rail", () => {
    const source = css("./components/EventPage.module.css");
    const steps = [...source.matchAll(/@container \((?:min-width: (\d+)px\) and \()?max-width: (\d+)px\) \{\s*\.coverMobile \{ width: (\d+)px; height: (\d+)px; \}\s*\.coverMobile \.coverArt \{ transform: scale\(([\d.]+)\); \}/g)];
    expect(steps.length).toBeGreaterThanOrEqual(5);
    for (const [, min, max, w, h, scale] of steps) {
      expect(w).toBe(h);
      expect(Number(scale)).toBeCloseTo(Number(w) / 1080, 4);
      // The narrowest page a step applies to: its min-width, or 320 for the max-width-only steps below 390.
      const narrowest = min ? Number(min) : Number(max) < 360 ? 320 : 360;
      expect(Number(w), `${w}px cover at ${narrowest}px`).toBeLessThanOrEqual(narrowest - 32);
    }
    expect(source).toMatch(/@container \(min-width: 768px\) and \(max-width: 1023px\) \{\s*\.grid \{ grid-template-columns: 260px minmax\(0, 1fr\)/);
  });
});

describe("v7 responsive pass: calendar", () => {
  const sameDay: PublicEvent[] = [
    { ...AI_ERA, slug: "a", title: "Morning", startsAt: "2026-10-08T08:00:00.000Z" },
    { ...AI_ERA, slug: "b", title: "Evening", startsAt: "2026-10-08T16:30:00.000Z" },
    { ...AI_ERA, slug: "c", title: "Next day", startsAt: "2026-10-09T16:30:00.000Z" },
  ];
  const page = (viewer: typeof MARIA | null = null) => html(<CalendarPage calendar={CALENDAR} tab="upcoming" events={sameDay} viewer={viewer} actions={actions} />);

  it("events on the same day share one date header: a row per day, a card per event", () => {
    const out = page();
    expect(count(out, 'class="row"')).toBe(2);
    expect(count(out, 'class="card"')).toBe(3);
    expect(count(out, ">8 Oct<")).toBe(1);
    expect(count(out, ">9 Oct<")).toBe(1);
    expect(out.indexOf(">Morning<")).toBeLessThan(out.indexOf(">Evening<"));
  });

  it("profile links: the website stays a text link, X and LinkedIn are their logos with a name and a 44px target", () => {
    const links = [
      { kind: "website" as const, label: "didit.me", href: "https://didit.me" },
      { kind: "x" as const, label: "X", href: "https://x.com/didit" },
      { kind: "linkedin" as const, label: "LinkedIn", href: "https://www.linkedin.com/company/91001155" },
    ];
    const out = html(<CalendarPage calendar={{ ...CALENDAR, links }} tab="upcoming" events={sameDay} viewer={null} actions={actions} />);
    expect(out).toMatch(/<a href="https:\/\/didit\.me"[^>]*class="link">didit\.me<svg/);
    for (const [href, label] of [["https://x.com/didit", "Didit on X"], ["https://www.linkedin.com/company/91001155", "Didit on LinkedIn"]]) {
      const link = out.match(new RegExp(`<a href="${href}"[^>]*>.*?</a>`))![0];
      expect(link).toContain(`class="link brandLink" aria-label="${label}"`);
      expect(link).toMatch(/<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M[^"]+"><\/path><\/svg><\/a>$/);
      expect(link).not.toMatch(/>X<|>LinkedIn</);
    }
    expect(css("./components/SocialIcons.module.css")).toMatch(/\.link \{ display: grid; place-items: center; width: var\(--tap-target\); height: var\(--tap-target\);/);
  });

  it("thumbnails are lazy images, the banner is preloaded first; one header serves phones and desktop", () => {
    const out = page(MARIA);
    for (const thumb of out.match(/<img[^>]*class="thumb"[^>]*>/g) ?? []) expect(thumb).toMatch(/width="96" height="96" loading="lazy"/);
    expect(count(out, 'class="thumb"')).toBe(3);
    // The banner stays a CSS background (shared with the /admin/calendar preview) and is preloaded from the head.
    expect(out).toMatch(/<link rel="preload" href="[^"]*bg-aqua[^"]*" as="image" fetchPriority="high"\/>/);
    // One site header: it is its own size container, so the phone bar is the same markup below 768px.
    expect(count(out, '<header class="header"><div class="bar">')).toBe(1);
    const header = css("./components/SiteHeader.module.css");
    expect(header).toMatch(/\.header \{ container: site-header \/ inline-size;/);
    expect(header).toMatch(/@container site-header \(max-width: 767px\) \{\s*\.bar \{ height: var\(--header-h-phone\); padding: 0 16px; \}/);
  });
});

describe("v7 responsive pass: message screens are never dead ends", () => {
  it("not found, gates and inactive invites link on to the calendar or the event", () => {
    const exploring = [<EventNotFound key="nf" />, <GateMessage key="c" event={AI_ERA} gate="closed" />, <GateMessage key="f" event={AI_ERA} gate="full" />, <GateMessage key="e" event={AI_ERA} gate="ended" />, <InviteMessage key="r" event={AI_ERA} state="revoked" />];
    for (const el of exploring) expect(html(el)).toMatch(/<a[^>]*href="\/events"[^>]*>Explore events<\/a>/);
    for (const state of ["verified", "in_review"] as const) expect(html(<InviteMessage event={AI_ERA} state={state} />)).toMatch(new RegExp(`<a[^>]*href="/e/${AI_ERA.slug}"[^>]*>See event</a>`));
  });

  it("the verification outcome keeps the site header (nav, avatar menu) for the signed-in guest", () => {
    const signedIn = html(<OutcomeMessage event={AI_ERA} state="approved" attemptsLeft={0} verify={noop} origin="https://events.didit.me" viewer={MARIA} />);
    expect(signedIn).toContain(">My events<");
    expect(signedIn).toContain('aria-haspopup="menu"');
    const anonymous = html(<OutcomeMessage event={AI_ERA} state="approved" attemptsLeft={0} verify={noop} origin="https://events.didit.me" />);
    expect(anonymous).not.toContain(">My events<");
    expect(anonymous).toContain(">EVENTS<");
  });
});

describe("v7 responsive pass: sheets, sign-in and touch targets", () => {
  it("a sheet without an event has no event cover behind it; an event sheet keeps its cover", () => {
    const plain = html(<GuestScreen sheet={{ variant: "account" }}>x</GuestScreen>);
    expect(plain).not.toContain("backdropCover");
    expect(plain).not.toContain("background-image");
    expect(html(<GuestScreen sheet={{ event: AI_ERA, variant: "account" }}>x</GuestScreen>)).toContain("backdropCover");
  });

  it("/login mounts the sign-in flow once (one form, one state), not a sheet and a modal copy", () => {
    const page = css("../../app/login/page.tsx");
    expect(count(page, "<LoginFlow ")).toBe(1);
    expect(page).not.toMatch(/mobileOnly|desktopOnly/);
  });

  it("small controls keep their look inside a 44px touch target; sheets and screens use the header's logo size", () => {
    const screen = css("../accounts/components/Screen.module.css");
    // Round 3: the 44px target is the button itself and ::before draws the 32px chip (the transparent-border trick left a ghost ring).
    for (const [file, name] of [[screen, "sheetClose"], [css("../accounts/components/join/Join.module.css"), "close"]] as const) {
      expect(file).toMatch(new RegExp(`\\.${name} \\{[^}]*width: 44px; height: 44px; margin: -6px;[^}]*border: 0;[^}]*background: none;`));
      expect(file).toMatch(new RegExp(`\\.${name}::before \\{[^}]*inset: 6px; border-radius: 50%; background: var\\(--chip\\);`));
      expect(file).not.toMatch(new RegExp(`\\.${name} \\{[^}]*background-clip`));
    }
    // The flow screens draw the site header (no header rules of their own); a sheet's top bar matches it on a phone.
    expect(screen).not.toMatch(/\n\.header \{/);
    expect(screen).toMatch(/\.sheetTop \{[^}]*align-items: center; gap: 12px; padding-top: 16px; \}/);
    expect(screen).toMatch(/\.sheetTop img \{[^}]*height: var\(--header-logo-h\); \}/);
    expect(screen).not.toMatch(/content: "[○●]"/);
    expect(screen).toMatch(/\.radioGlyph \{[^}]*width: 20px; height: 20px;[^}]*border-radius: 50%;/);
    const join = css("../accounts/components/join/Join.module.css");
    expect(join).toMatch(/\.close \{[^}]*width: 44px; height: 44px; margin: -6px;/);
    const header = css("./components/SiteHeader.module.css");
    expect(header).toMatch(/\.brand \{[^}]*min-height: var\(--tap-target\);/);
    expect(header).toMatch(/@container site-header \(max-width: 767px\) \{[^@]*\.signIn\.signIn \{ height: var\(--tap-target\);/);
    const tokens = css("../../../../packages/ui/src/tokens.css");
    for (const token of ["--header-logo-h:  24px;", "--header-avatar:  32px;", "--tap-target:     44px;"]) expect(tokens).toContain(token);
    expect(css("./components/AccountMenu.module.css")).toMatch(/\.trigger \{[^}]*padding: 6px; margin: -6px;/);
    const field = css("../../../../packages/ui/src/components/Field.module.css");
    expect(field).toMatch(/@media \(max-width: 767px\) \{\s*\.control, \.fieldLg \.control, \.fieldXl \.control \{ min-height: 44px; font-size: 16px; \}/);
  });
});

describe("v7 responsive pass, round 3", () => {
  const signIn = async (prev: SignInStep) => prev;
  const login = (props: Partial<React.ComponentProps<typeof LoginFlow>> = {}) =>
    html(<LoginFlow layout="sheet" initial={{ step: "choose" }} action={signIn} next="/me/events" googleHref="/api/auth/oidc/start?idp=google" {...props} />);

  it("/login shows the legal copy once: the disclosure with its links, no second 'you agree' line", () => {
    for (const out of [login(), login({ layout: "modal" })]) {
      expect(count(out, "By continuing you")).toBe(1);
      expect(out).not.toContain("you agree to the Terms");
      expect(out).toContain(">Terms</a>");
      expect(out).toContain(">Privacy</a>");
    }
  });

  it("an admin sign-in (next=/admin…) gets its title and lead on the server, so the first paint is final", () => {
    const page = css("../../app/login/page.tsx");
    expect(page).toMatch(/const admin = \/\^\\\/admin\(\?:\[\/\?#\]\|\$\)\/\.test\(next\);/);
    expect(page).toContain('"Sign in to Didit Events admin"');
    const out = login({ next: "/admin", title: "Sign in to Didit Events admin", lead: "Sign in with your Didit Events account to manage events. No password." });
    expect(out).toContain("Sign in to Didit Events admin</h1>");
    expect(out).toContain("to manage events");
    expect(out).not.toContain("to request a place");
  });

  it("a sheet route loads inside the sheet frame (full screen on phones, the centred modal from 768px), not a phone column", () => {
    const sheet = html(<FlowSkeleton sheet />);
    for (const cls of ["root", "wModal", "pageSheet", "sheetBackdrop", "modal", "sheetTop"]) expect(sheet, cls).toMatch(new RegExp(`class="[^"]*\\b${cls}\\b`));
    expect(html(<FlowSkeleton />)).not.toContain("pageSheet");
  });

  it("covers are requested at a display width the cover route knows; other URLs pass through", () => {
    expect(coverAt("/api/events/1/cover?v=2", 720)).toBe("/api/events/1/cover?v=2&w=720");
    expect(coverAt("/_next/static/media/bg-aqua.webp", 720)).toBe("/_next/static/media/bg-aqua.webp");
    expect(heroCoverSrcSet("/_next/static/media/bg-aqua.webp")).toBeUndefined();
    const widths: readonly number[] = COVER_WIDTHS;
    for (const w of [192, 720, 1080]) expect(widths).toContain(w);
    const calendar = html(<CalendarPage calendar={CALENDAR} tab="upcoming" events={[{ ...AI_ERA, cover: { ...AI_ERA.cover, src: "/api/events/1/cover?v=2" } }]} viewer={null} actions={actions} />);
    expect(calendar).toContain('src="/api/events/1/cover?v=2&amp;w=192"');
  });

  it("a disabled destructive button is a danger tint, not the secondary grey; segmented items space label and count", () => {
    const button = css("../../../../packages/ui/src/components/Button.module.css");
    expect(button).toMatch(/\.destructive:disabled:not\(\[aria-busy="true"\]\)[^{]*\{ --bg: var\(--danger-bg\); --fg: var\(--danger-fg\); opacity: 1; \}/);
    expect(css("../../../../packages/ui/src/components/EventBits.module.css")).toMatch(/\.segItem \{ gap: 6px;/);
  });

  it("the header sits on one 1000px column on every page; the two dead-end screens share that bar and a primary way on", () => {
    const header = css("./components/SiteHeader.module.css");
    expect(header).toMatch(/\.bar \{[^}]*padding: 0 max\(32px, calc\(\(100% - var\(--header-max-w\)\) \/ 2\)\);/);
    // No page moves the logo: the calendar's narrower column no longer narrows the header.
    expect(css("./components/CalendarPage.module.css")).not.toContain("--site-header-w");
    for (const el of [<EventNotFound key="nf" />, <GateMessage key="g" event={AI_ERA} gate="closed" />]) expect(count(html(el), '<header class="header"><div class="bar">')).toBe(1);
    const notFound = html(<EventNotFound />);
    expect(notFound).toContain("centerInline");
    expect(notFound).toMatch(/<a[^>]*class="[^"]*\bprimary\b[^"]*"[^>]*>Explore events<\/a>/);
  });
});

describe("v10 polish: header, footer, columns", () => {
  it("phones: the header is only the logo and the avatar (the EVENTS tag hides below 768px)", () => {
    expect(css("./components/SiteHeader.module.css")).toMatch(/@container site-header \(max-width: 767px\) \{[^@]*\.clock, \.staff, \.link, \.tag \{ display: none; \}/);
  });

  it("events.didit.me has no footer, no Subscribe and no stats line", () => {
    const calendar = html(<CalendarPage calendar={CALENDAR} tab="upcoming" events={[AI_ERA]} viewer={null} actions={actions} />);
    for (const out of [eventPage(AI_ERA), calendar]) for (const gone of ["<footer", ">Subscribe<", "subscribers"]) expect(out, gone).not.toContain(gone);
    // Phone cover: the body column's full width (same edges as the title), the 1080px art scaled to it.
    expect(css("./components/EventPage.module.css")).toMatch(/\.mBody \.coverMobile \{ width: 100%; height: auto; aspect-ratio: 1 \/ 1;[^}]*container-type: inline-size; \}\n\.mBody \.coverMobile \.coverArt \{ transform: scale\(tan\(atan2\(100cqw, 1080px\)\)\); \}/);
  });

  it("the calendar column is the header's column from 768px, with the 16px phone gutter below it", () => {
    const calendarCss = css("./components/CalendarPage.module.css");
    expect(calendarCss).toMatch(/\.main \{[^}]*width: min\(var\(--header-max-w\), calc\(100% - 64px\)\);/);
    expect(calendarCss).toMatch(/@media \(max-width: 767px\) \{\s*\.main \{ width: calc\(100% - 32px\); \}/);
  });

  it("the settled registration card does not replay the check's pop on every load", () => {
    const going = html(<EventPage event={AI_ERA} related={[]} viewer={MARIA} card={{ kind: "going", viewer: MARIA }} now={new Date("2026-10-01T10:00:00Z")} actions={actions} />);
    expect(going).toContain('data-status-icon="success"');
    expect(going).not.toContain("data-animate");
  });

  it("message and invite screens share the header's 16px gutter on phones", () => {
    for (const file of ["./components/MessageScreen.module.css", "./components/InviteScreen.module.css"]) expect(css(file)).toMatch(/\.body \{[^}]*padding: 20px 16px; \}/);
  });
});
