import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EventHeaderInfo } from "../types";
import { AdminShell } from "../shell/AdminShell";
import { EventHeader } from "./EventHeader";

const css = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
/** The body of the first `@container admin (<condition>)` block of a CSS file. */
const block = (source: string, condition: string) => {
  const start = source.indexOf(`@container admin (${condition}) {`);
  if (start < 0) return "";
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return "";
};

const shell = css("../shell/AdminShell.module.css");
const header = css("./EventHeader.module.css");
const applicants = css("../applicants/Applicants.module.css");
const guests = css("../guests/Guests.module.css");
const log = css("../log/Log.module.css");

const event: EventHeaderInfo = { id: "e1", name: "Building, Raising & Scaling in the AI Era", status: "open", when: "Thu, 8 Oct 2026", requestLink: "events.didit.me/e/ai-era", guestCount: 3, requestCount: 2 };

describe("admin shell below 900px (phones and tablet portrait)", () => {
  it("hides the sidebar with a selector that outranks the ui sidebar's own single-class rule (no chunk-order dependence)", () => {
    const narrow = block(shell, "max-width: 900px");
    expect(narrow).toContain(".shell > .sidebar { display: none; }");
    expect(narrow).not.toMatch(/\n\s*\.sidebar \{/);
    expect(narrow).toContain(".shell > .mobileBar { display: block; }");
    expect(shell).toContain("\n.shell > .mobileBar { display: none; }");
  });
  it("the phone bar is the site header: the same logo, tag and avatar as the public pages, no bar of its own", () => {
    const user = { name: "Alberto Rosas", email: "events.team@didit.me", initials: "A", role: "owner" as const };
    const html = renderToStaticMarkup(<AdminShell active="events" user={user}>x</AdminShell>);
    expect(html).toMatch(/<header class="header mobileBar"><div class="bar"><a href="\/admin"[^>]*><img[^>]*height="24"[^>]*\/><span class="tag" aria-hidden="true">EVENTS<\/span><\/a>/);
    // The sidebar draws the logo at the same height.
    expect(html.match(/<img[^>]*height="24"/g)).toHaveLength(2);
    expect(shell).not.toMatch(/\.menuPanel|\.mobileLogo|\.mobileBack|\.barEnd/);
  });
});

describe("event header and tabs on narrow widths", () => {
  it("keeps the header on phones and never hides a tab: the strip scrolls", () => {
    const phone = block(header, "max-width: 600px");
    expect(phone).not.toMatch(/\.head \{[^}]*display: none/);
    // In the phone column a flex-basis is a height: the title block and the actions take their content's.
    expect(phone).toContain(".head[data-tab] .text, .head[data-tab] .side { flex: none; }");
    expect(header).not.toContain("nth-child(n + 5)");
    const tablet = block(header, "max-width: 1100px");
    expect(tablet).toMatch(/\.tabs\.tabs \{[^}]*overflow-x: auto/);
    expect(tablet).not.toContain("overflow: hidden; }\n  .tabs");
    expect(phone).toMatch(/\.tabs a \{[^}]*min-height: 44px/);
  });
  it("lets the title keep the row and the actions wrap below it up to 1100px", () => {
    const tablet = block(header, "max-width: 1100px");
    expect(tablet).toMatch(/\.head \{[^}]*flex-wrap: wrap/);
    expect(tablet).toMatch(/\.side \{[^}]*flex-wrap: wrap/);
    // The same on every tab: the actions always take their own row, so the header does not jump between tabs.
    expect(tablet).toContain(".head[data-tab] .text { flex: 1 1 100%; }");
    expect(tablet).toMatch(/\.side \{ flex: 1 1 100%;/);
    // The status pill and the date line stay on tablets (only the breadcrumb goes).
    expect(tablet).not.toMatch(/\.pill[^{]*\{[^}]*display: none/);
    expect(tablet).not.toMatch(/\.meta[^{]*\{[^}]*display: none/);
  });
  it("puts the tab's own actions and the shared ones in one group, after the title block", () => {
    const html = renderToStaticMarkup(<EventHeader event={event} tab="applicants" actions={<><a href="#invite">Invite guests</a><a href="#door">Open door</a></>} />);
    expect(html).toContain('<div class="side"><a href="#invite">Invite guests</a><a href="#door">Open door</a></div>');
    expect(renderToStaticMarkup(<EventHeader event={event} tab="guests" />)).not.toContain('class="side"');
  });
  it("lists every tab of the viewer on any width", () => {
    const html = renderToStaticMarkup(<EventHeader event={event} tab="settings" />);
    for (const tab of ["Overview", "Guests", "Requests", "Check-in log", "Door", "Team", "Settings"]) expect(html).toContain(tab);
    expect(html).toMatch(/aria-current="page"[^>]*>Settings</);
  });
});

describe("tab bodies on narrow widths", () => {
  it("applicants: the toolbar wraps and each row becomes a card on phones", () => {
    const tablet = block(applicants, "max-width: 1100px");
    expect(tablet).toMatch(/\.toolbar \{[^}]*flex-wrap: wrap/);
    expect(tablet).toMatch(/\.meter \{[^}]*flex: 1 1 100%/);
    const phone = block(applicants, "max-width: 600px");
    expect(phone).toMatch(/\.row \{ grid-template-columns: 32px minmax\(0, 1fr\);[^}]*height: auto/);
    expect(phone).toContain(".head > :not(:first-child) { display: none; }");
    expect(phone).toMatch(/\.acts button \{[^}]*height: 44px/);
    // The segment count keeps its space where the items are flex, the Requested header fits on tablets, and an
    // empty list shows no select-all bar on phones.
    expect(applicants).toMatch(/\.seg a \{[^}]*gap: 0\.3em/);
    expect(tablet).toMatch(/\.row \{ grid-template-columns: [^}]*minmax\(96px, 0\.8fr\) 230px/);
    expect(phone).toContain(".table:has(.empty) .head { display: none; }");
  });
  it("requests header: the seven actions wrap under the title instead of squeezing it at 1440", () => {
    const wide = block(header, "max-width: 1500px");
    expect(wide).toContain('.head[data-tab="applicants"] { flex-wrap: wrap;');
    expect(wide).toContain('.head[data-tab="applicants"] .text { flex: 1 1 560px; }');
  });
  it("guests: hides the desktop chips and export with scoped selectors, and the phone chips scroll in one row", () => {
    const tablet = block(guests, "max-width: 1100px");
    expect(tablet).toContain(".toolbar .chips, .toolbar .export, .desktop { display: none; }");
    expect(tablet).toMatch(/\.toolbar \{[^}]*flex-wrap: wrap/);
    const phone = block(guests, "max-width: 600px");
    expect(phone).toMatch(/\.phoneChips > nav \{ flex-wrap: nowrap; overflow-x: auto;/);
  });
  it("log: the chips take their own row and the table drops columns instead of clipping them", () => {
    const tablet = block(log, "max-width: 1100px");
    expect(tablet).toMatch(/\.toolbar \{[^}]*flex-wrap: wrap/);
    expect(tablet).toMatch(/\.toolbar \.chips, \.chipsPending \{[^}]*flex: 1 1 100%/);
    expect(tablet).toContain('.table [role="table"] { min-width: 0; }');
    const phone = block(log, "max-width: 600px");
    expect(phone).toMatch(/\.filterForm \{[^}]*align-items: center/);
  });
  it("log on phones: each scan is a stacked card (no clipped columns), and the chips scroll inside the gutters", () => {
    const phone = block(log, "max-width: 600px");
    // Result + time, then guest + door: two lines, the time on an auto track (HH:MM:SS never truncates).
    expect(phone).toMatch(/\[role="row"\]:not\(:has\(\[aria-colspan\]\)\) \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto !important; grid-template-areas: "result time" "guest door";[^}]*height: auto; min-height: 44px/);
    expect(phone).toContain('.table:not(.missing) [role="row"] > :nth-child(4) { display: none; }');
    // The column names stay in the accessibility tree; an unmatched scan does not repeat its result as the guest.
    expect(phone).toMatch(/\[role="rowgroup"\]:first-child \{ position: absolute;[^}]*clip-path: inset\(50%\)/);
    expect(phone).toMatch(/\[role="row"\]:has\(\.anon\) > :nth-child\(3\) \{ position: absolute;/);
    expect(phone).toMatch(/\.toolbar \.chips \{[^}]*overflow-x: auto;[^}]*margin: -6px 0;[^}]*mask-image/);
    expect(phone).not.toContain("-16px");
  });
});
