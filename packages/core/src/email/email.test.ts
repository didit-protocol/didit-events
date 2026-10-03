import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emailFixtures } from "./fixtures.ts";
import { fmtCode, fmtDay, fmtDayTimeZone, fmtWhen } from "./format.ts";
import { DIDIT_SENT_CODES, EMAIL_CODES, emailTemplates, renderEmail, type EmailDataByCode } from "./index.ts";
import { esc, renderHtml, safeUrl } from "./layout.ts";
import { EMAIL_RADII, EMAIL_RADIUS_SOURCES, EMAIL_TOKEN_SOURCES, EMAIL_TOKENS } from "./tokens.ts";

const render = <C extends keyof EmailDataByCode>(code: C, data: Partial<EmailDataByCode[C]> = {}) =>
  renderEmail(code, { ...emailFixtures[code], ...data });

/** Visible text of the HTML (tags stripped, entities decoded), whitespace collapsed. */
const visible = (html: string) =>
  html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<div style="display:none[\s\S]*?<\/div>/, "")
    .replace(/<br>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&zwnj;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Outlook-safety problems in an email document: unbalanced conditional comments (every `<!--[if …]>` needs its own
 * `<![endif]-->` before the next one opens) and CSS background images outside the Outlook-only VML blocks.
 */
function outlookIssues(html: string): string[] {
  const issues: string[] = [];
  const tokens = [...html.matchAll(/<!--\[if [^\]]+\]>(?:<!-->)?|<!(?:--)?\[endif\]-->/g)];
  let open = false;
  for (const t of tokens) {
    const opener = t[0].startsWith("<!--[if");
    if (opener === open) issues.push(`${opener ? "nested" : "stray"} ${t[0]} at ${t.index}`);
    open = opener;
  }
  if (open) issues.push("unclosed conditional comment");
  const outsideMso = html.replace(/<!--\[if [^\]]*mso[^\]]*\]>[\s\S]*?<!\[endif\]-->/g, "");
  for (const m of outsideMso.matchAll(/background(?:-image)?\s*:[^;"'}]*url\(/gi)) issues.push(`CSS background image: ${m[0]}`);
  return issues;
}

describe("email formatting", () => {
  it("formats dates in the event time zone with fixed English names", () => {
    const start = new Date("2026-10-08T18:30:00+02:00");
    const end = new Date("2026-10-08T21:30:00+02:00");
    expect(fmtWhen(start, end, "Europe/Madrid")).toBe("Thu 8 Oct 2026, 18:30–21:30 CEST");
    expect(fmtWhen(start, end, "Europe/Madrid", { zone: false })).toBe("Thu 8 Oct 2026, 18:30–21:30");
    // DST change (25 Oct 2026, 03:00 CEST → 02:00 CET): each end is labelled with its own zone.
    const dstStart = new Date("2026-10-24T23:30:00Z"); // 01:30 CEST
    const dstEnd = new Date("2026-10-25T02:30:00Z"); // 03:30 CET
    expect(fmtWhen(dstStart, dstEnd, "Europe/Madrid")).toBe("Sun 25 Oct 2026, 01:30 CEST–03:30 CET");
    expect(fmtWhen(dstStart, dstEnd, "Europe/Madrid", { zone: false })).toBe("Sun 25 Oct 2026, 01:30–03:30");
    expect(fmtDay(new Date("2026-09-29T12:00:00Z"), "Europe/Madrid")).toBe("Tue 29 Sep");
    expect(fmtDayTimeZone(new Date("2026-12-01T09:05:00Z"), "Europe/Madrid")).toBe("Tue 1 Dec, 10:05 CET");
    // Local date, not UTC: 23:30 UTC on the 7th is the 8th in Madrid.
    expect(fmtDay(new Date("2026-10-07T23:30:00Z"), "Europe/Madrid")).toBe("Thu 8 Oct");
    expect(fmtCode("481903")).toBe("481 903");
  });

  it("escapes text and refuses unsafe URLs", () => {
    expect(esc(`<b>"x" & 'y'</b>\nz`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;<br>z");
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("//evil.example")).toBe("#");
    expect(safeUrl("data:text/html,x")).toBe("#");
    expect(safeUrl("https://events.didit.me/e?a=1&b=2")).toBe("https://events.didit.me/e?a=1&amp;b=2");
    expect(safeUrl("/email/didit-logo.png")).toBe("/email/didit-logo.png");
  });

  it("keeps the literal colours in sync with packages/ui tokens.css", () => {
    const css = readFileSync(new URL("../../../ui/src/tokens.css", import.meta.url), "utf8");
    for (const [key, variable] of Object.entries(EMAIL_TOKEN_SOURCES)) {
      if (!variable) continue;
      const m = new RegExp(`${variable}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
      expect(m?.[1]?.toUpperCase(), variable).toBe(EMAIL_TOKENS[key as keyof typeof EMAIL_TOKENS]);
    }
  });

  it("takes the hero radius from the token the public event page cover uses", () => {
    const css = readFileSync(new URL("../../../ui/src/tokens.css", import.meta.url), "utf8");
    for (const [key, variable] of Object.entries(EMAIL_RADIUS_SOURCES)) {
      const m = new RegExp(`${variable}:\\s*(\\d+)px`).exec(css);
      expect(Number(m?.[1]), variable).toBe(EMAIL_RADII[key as keyof typeof EMAIL_RADII]);
    }
    const page = readFileSync(new URL("../../../../apps/events/src/public/components/EventPage.module.css", import.meta.url), "utf8");
    expect(page).toMatch(/\.coverDesktop, \.coverMobile \{[^}]*border-radius: var\(--radius-md\)/);
  });
});

describe("email templates", () => {
  it("M-19 carries the message and makes admission conditional on request and capacity", () => {
    const review = render("M-19", { message: "Join us for the discussion", skipApproval: false });
    expect(review.text).toContain("Join us for the discussion");
    expect(review.text).toContain("The host will email you with a decision");
    expect(review.text).not.toContain("No approval needed");
    const waitlisted = render("M-19", { waitlisted: true });
    expect(waitlisted.text).toContain("you can join the waitlist");
    expect(waitlisted.text).not.toContain("saved you a place");
  });
  it("covers M-01…M-29, E-01…E-03 and T-01, each with a fixture", () => {
    const expected = [
      ...Array.from({ length: 29 }, (_, i) => `M-${String(i + 1).padStart(2, "0")}`),
      "E-01",
      "E-02",
      "E-03",
      "T-01",
    ];
    expect([...EMAIL_CODES].sort()).toEqual(expected.sort());
    for (const code of EMAIL_CODES) expect(emailFixtures[code], code).toBeDefined();
  });

  it.each(EMAIL_CODES)("%s renders Outlook-safe HTML, a subject and a text part", (code) => {
    const t = emailTemplates[code];
    const out = renderEmail(code, emailFixtures[code] as never);
    expect(out.subject.length).toBeGreaterThan(5);
    expect(out.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out.html).toContain(`<title>${esc(out.subject)}</title>`);
    expect(out.html).toContain('width="600"');
    expect(out.html).toContain("Didit Identity Spain, S.L.");
    // No layout the major clients drop: flex/grid, external stylesheets, scripts, CSS variables.
    expect(out.html).not.toMatch(/display:\s*(flex|grid)|<link |<script|var\(--/);
    // Balanced MSO conditionals; background photos only through the `background` attribute + VML, never CSS url().
    expect(outlookIssues(out.html)).toEqual([]);
    // Every interpolated string lands escaped (no raw ampersand from "Building, Raising & Scaling").
    expect(out.html).not.toMatch(/&(?![a-z]+;|#\d+;)/);
    const doc = t.doc(emailFixtures[code] as never);
    expect(visible(out.html)).toContain(visible(esc(doc.headline)));
    expect(out.text).toContain(doc.headline);
    expect(out.text).toContain(doc.body);
    expect(out.text).not.toMatch(/<[a-z]/i);
    expect(out.from.address).toMatch(/@didit\.me$|^events@example\.com$/);
  });

  it("uses the design copy (M-01, M-02, M-06, M-16)", () => {
    const m01 = render("M-01");
    expect(m01.subject).toBe("Your Didit Events code: 481 903");
    expect(visible(m01.html)).toContain(
      "Enter this code to confirm your email before requesting a place at Building, Raising & Scaling in the AI Era. 481 903 Expires in 10 minutes. Never share it with anyone.",
    );
    const m02 = render("M-02");
    expect(m02.subject).toBe("We got your request for Building, Raising & Scaling in the AI Era");
    expect(visible(m02.html)).toContain("When Thu 8 Oct 2026, 18:30–21:30 CEST Where Didit HQ, Carrer de Pallars 99, Barcelona View event");
    expect(m02.html).toContain('src="/e/ai-era/opengraph-image" width="560"');
    expect(render("M-06").subject).toBe("You're in: Thu 8 Oct, Didit HQ");
    const m16 = render("M-16");
    expect(m16.subject).toBe("Update: doors now open at 18:45");
    expect(visible(m16.html)).toContain("Before 18:30 Now 18:45 · Thu 8 Oct Where Didit HQ, Barcelona");
    expect(render("E-01").html).toContain("Fri 23 Oct 2026, 19:00–23:00 CEST<");
  });

  it("M-19 uses the canonical event cover with Outlook-safe image markup", () => {
    const html = render("M-19").html;
    expect(html).toContain('src="/e/ai-era/opengraph-image" width="560"');
    expect(outlookIssues(html)).toEqual([]);
    // The checker itself catches the regressions it guards against.
    expect(outlookIssues(`<td style="background:#fff url('x.jpg') center / cover">`)).toHaveLength(1);
    expect(outlookIssues(`<td style="background-image:url(x.jpg)">`)).toHaveLength(1);
    expect(outlookIssues(`<!--[if mso]><v:fill style="background:url(x.jpg)"/><![endif]-->`)).toEqual([]);
    expect(outlookIssues("<!--[if mso]><table><tr><td>")).toEqual(["unclosed conditional comment"]);
    expect(outlookIssues("<!--[if mso]>a<!--[if mso]>b<![endif]-->")).toHaveLength(1);
    expect(outlookIssues("a<![endif]-->")).toHaveLength(1);
  });

  it("every M-* email with a cover hero shows the banner inset, rounded like the event page cover, Outlook-safe", () => {
    const banner = "https://events.didit.me/api/events/e1/cover?v=wide-1";
    const withHero = EMAIL_CODES.filter((code) => code.startsWith("M-")).flatMap((code) => {
      const fixture = emailFixtures[code] as { event?: object };
      if (!fixture.event) return [];
      const html = renderEmail(code, { ...fixture, event: { ...fixture.event, coverImageUrl: banner } } as never).html;
      return html.includes(`src="${banner}"`) ? [[code, html] as const] : [];
    });
    expect(withHero.map(([code]) => code).sort()).toEqual(["M-02", "M-03", "M-06", "M-11", "M-14", "M-19", "M-27"]);
    for (const [code, html] of withHero) {
      const img = new RegExp(`<td class="em-hero-inset" style="padding:20px 20px 0;[^"]*"><img src="${banner.replace(/[.?]/g, "\\$&")}" width="560" alt="[^"]*" style="([^"]*)">`).exec(html);
      expect(img, code).not.toBeNull();
      expect(img![1], code).toContain(`border-radius:${EMAIL_RADII.cover}px`);
      expect(img![1], code).toContain("height:auto");
      expect(html, code).not.toMatch(/height="315"/);
      expect(outlookIssues(html), code).toEqual([]);
    }
  });

  it.each(["M-06", "M-23"] as const)("%s: one primary ticket button, an icon calendar pair and a quiet cancel link", (code) => {
    const out = render(code, { assetsUrl: undefined, baseUrl: "https://events.didit.me" });
    const html = out.html;
    // Exactly one full-width primary (black) pill, carrying the ticket icon.
    expect(html.match(/bgcolor="#1A1A1A"/g)).toHaveLength(1);
    expect(html).toMatch(/<a href="https:\/\/events\.didit\.me\/me\/events\/ai-era"[^>]*><img src="https:\/\/events\.didit\.me\/email-icons\/ticket\.png" width="20" height="20" alt="Ticket"[^>]*>View your ticket<\/a>/);
    // Calendar pair: absolute PNG icons with alt text and size attributes, stacked on mobile.
    expect(visible(html)).toContain("ADD TO CALENDAR Google Calendar Apple / Outlook (.ics) Can’t make it? Cancel your place");
    for (const [icon, alt] of [["google-calendar", "Google Calendar"], ["apple", "Apple"]]) {
      expect(html).toContain(`<img src="https://events.didit.me/email-icons/${icon}.png" width="20" height="20" alt="${alt}"`);
    }
    expect(html.match(/class="em-col"/g)).toHaveLength(2);
    expect(html).toContain(".em-col{display:block !important;width:100% !important}");
    expect(html).not.toMatch(/\.svg|<svg|icon-font|font-awesome/i);
    // Cancel is a text link, never a pill: the cancel URL never sits inside a button cell.
    expect(html).toMatch(/Can’t make it\? <a href="https:\/\/events\.didit\.me\/me\/events\/ai-era\/cancel"[^>]*text-decoration:underline">Cancel your place<\/a>/);
    expect(html).not.toMatch(/bgcolor="[^"]+"[^>]*><a href="[^"]*\/cancel"/);
    expect(html).not.toMatch(/>Cancel place</);
    // Plain text lists every action with its link.
    expect(out.text).toContain("View your ticket: https://events.didit.me/me/events/ai-era");
    expect(out.text).toContain("Google Calendar: https://events.didit.me/e/ai-era/calendar/google");
    expect(out.text).toContain("Apple / Outlook (.ics): https://events.didit.me/e/ai-era/event.ics");
    expect(out.text).toContain("Can’t make it? Cancel your place: https://events.didit.me/me/events/ai-era/cancel");
  });

  it("M-06 keeps the explicit cancel URL and shows the renewal action without the ticket icon", () => {
    const out = render("M-06", { cancelUrl: "https://events.didit.me/x/cancel-me", renewalNeeded: true, renewalChecks: ["selfie"] });
    expect(out.text).toContain("Renew required checks: https://events.didit.me/me/events/ai-era");
    expect(out.text).toContain("Cancel your place: https://events.didit.me/x/cancel-me");
    expect(out.html).not.toContain("ticket.png");
    expect(out.html).toContain('src="/email-icons/google-calendar.png"');
  });

  it("M-17 is a sign-in code (no magic link) valid for 5 minutes", () => {
    const m17 = render("M-17");
    expect(m17.subject).toBe("Your Didit Events sign-in code");
    expect(visible(m17.html)).toContain("481 903 Valid for 5 minutes.");
    expect(visible(m17.html)).toContain("If you didn’t ask for this, ignore this email.");
    expect(visible(m17.html)).toContain("Requested Tue 29 Sep, 18:14 CEST");
    expect(m17.html).not.toMatch(/auth\/verify|Sign in<\/a>/);
    expect(DIDIT_SENT_CODES).toContain("M-17");
  });

  it("switches state variants from data", () => {
    expect(render("M-08", { attemptsLeft: 2 }).text).toContain("You have 2 attempts left.");
    expect(render("M-08").text).toContain("You have 1 attempt left.");
    expect(render("M-16", { change: { kind: "venue", before: "Didit HQ, Barcelona" } }).subject).toBe("Update: new venue for the AI Era evening");
    const earlier = emailTemplates["M-16"].doc({ ...emailFixtures["M-16"], change: { kind: "time", before: new Date("2026-10-08T19:00:00+02:00") } });
    expect(earlier.preheader).toBe("Same place, 15 minutes earlier.");
    expect(render("M-20", { kind: "withdrawn", reason: undefined }).text).toContain("WITHDRAWN");
    expect(render("M-19", { message: undefined }).html).not.toContain("“");
    expect(render("M-22", { cancelledPlaces: 0, cancelledRequests: 0 }).text).toContain("We deleted your Didit Events profile. We asked Didit");
    expect(render("M-22").text).toContain("cancelled 1 upcoming place and 2 requests.");
    expect(render("M-01", { eventName: undefined }).text).toContain("sign in to Didit Events");
  });

  it("escapes hostile data and neutralises hostile links", () => {
    const out = render("M-19", {
      inviter: { firstName: `<img src=x onerror=alert(1)>` },
      acceptUrl: "javascript:alert(1)",
    });
    expect(out.html).not.toContain("<img src=x");
    expect(out.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(out.html).toContain('href="#"');
  });

  it("uses absolute asset URLs when only baseUrl is given (real sends)", () => {
    const out = render("M-07", { assetsUrl: undefined, baseUrl: "https://events-staging.example.com/" });
    expect(out.html).toContain('src="https://events-staging.example.com/email/didit-logo.png"');
    expect(out.html).toContain("https://events-staging.example.com/me/settings");
  });

  it("applies the mobile overrides (390) through a media query", () => {
    const html = renderHtml(emailTemplates["E-01"].doc(emailFixtures["E-01"]));
    const mobile = html.slice(html.indexOf("@media (max-width:480px)"));
    expect(mobile).toContain(".em-pad{padding:28px 20px !important}");
    expect(html).toContain('class="em-pad" style="padding:36px 44px 32px;');
  });
});
