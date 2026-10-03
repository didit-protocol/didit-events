import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LOG_SCANS, LOG_SUMMARY_BEFORE, LOG_SUMMARY_LIVE, MISSING_GUESTS, fixtureSummary } from "./fixtures";
import { DEFAULT_FILTERS, filterScans, logChips, logEmptyCopy, logHref, parseLogFilters, summarizeScans, toLogRow, toMissingRow } from "./helpers";
import { LogResults, LogToolbar } from "./LogView";
import { LogGuestCell } from "./LogGuestCell";
import { ScanDrawer } from "./ScanDrawer";
import type { Scan } from "./types";

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const ID = "bcn-opening";

describe("A-09 filters", () => {
  it("parses and round-trips the URL filters", () => {
    const f = parseLogFilters({ view: "missing", result: "welcomed", door: "terrace", people: "0" });
    expect(f).toEqual({ view: "missing", result: "welcomed", door: "terrace", people: false });
    expect(logHref(ID, f)).toBe("/admin/events/bcn-opening/log?view=missing&result=welcomed&door=terrace&people=0");
    expect(parseLogFilters({ result: "hack", door: "all" })).toEqual(DEFAULT_FILTERS);
    expect(logHref(ID)).toBe("/admin/events/bcn-opening/log");
  });

  it("builds the drawn chips with counts", () => {
    const labels = logChips(ID, LOG_SUMMARY_LIVE, DEFAULT_FILTERS).map((c) => c.label);
    expect(labels).toEqual(["All 186", "Welcomed 42", "Welcome back 9", "Unknown face 3", "Not on list 2", "Not verified 2"]);
  });

  it("filters by door and result, newest first", () => {
    const terrace = filterScans(LOG_SCANS, { ...DEFAULT_FILTERS, door: "terrace" });
    expect(terrace.map((s) => s.guestName)).toEqual(["Lucía Fernández", "Carlos Mendoza"]);
    expect(filterScans(LOG_SCANS, { ...DEFAULT_FILTERS, result: "not_on_list", door: "terrace" })).toEqual([]);
  });

  it("sorts by instant, not by string, across mixed offsets", () => {
    const scan = (id: string, at: string) => ({ ...LOG_SCANS[0]!, id, at });
    const scans = [
      scan("a", "2026-10-23T19:05:00+02:00"), // 17:05Z
      scan("b", "2026-10-23T17:30:00Z"), // 17:30Z (string-wise the smallest)
      scan("c", "2026-10-23T18:10:00+01:00"), // 17:10Z
      scan("d", "2026-10-23T17:20:00.500Z"),
    ];
    expect(filterScans(scans, { ...DEFAULT_FILTERS, people: false }).map((s) => s.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("formats a row: seconds clock, low match, latency", () => {
    const row = toLogRow(LOG_SCANS[3]!, LOG_SUMMARY_LIVE.doors, "Europe/Madrid", ID);
    expect(row).toMatchObject({ time: "19:40:17", result: "Unknown face", guest: "Unknown face", anonymous: true, faceOnly: true, href: "/admin/events/bcn-opening/log?scan=scn_07", match: "61%", lowMatch: true, door: "Main door", latency: "1.6s" });
    expect(toMissingRow(MISSING_GUESTS[0]!, ID, "Europe/Madrid")).toMatchObject({ verified: "Verified 22 Oct", phoneHref: "tel:+2348035550142" });
  });

  it("empty copy: before doors (c) and filtered (d)", () => {
    expect(logEmptyCopy(LOG_SUMMARY_BEFORE, DEFAULT_FILTERS, 0)).toEqual({
      title: "Scans will appear here once the door is running.",
      help: "Doors open at 19:00. Main door is running.",
    });
    const f = { ...DEFAULT_FILTERS, result: "not_on_list" as const, door: "terrace" };
    expect(logEmptyCopy(fixtureSummary(LOG_SUMMARY_LIVE, f), f, 0)).toEqual({ title: "No scans match these filters.", help: "Nobody outside the list has been scanned at Terrace." });
  });
});

describe("A-09 render", () => {
  it("live: toolbar, chips and the ten rows", () => {
    const html = decode(renderToStaticMarkup(<><LogToolbar eventId={ID} summary={LOG_SUMMARY_LIVE} filters={DEFAULT_FILTERS} /><LogResults eventId={ID} summary={LOG_SUMMARY_LIVE} filters={DEFAULT_FILTERS} page={{ view: "all", scans: LOG_SCANS }} /></>));
    expect(html).toContain("All scans");
    expect(html).toContain("Missing · 56");
    expect(html).toContain("Show only people");
    expect(html).toContain("Rafael Nadal Pons");
    expect(html).toContain("19:42:08");
  });

  it("missing view links each guest to manual check-in", () => {
    const html = decode(renderToStaticMarkup(<LogResults eventId={ID} summary={LOG_SUMMARY_LIVE} filters={{ ...DEFAULT_FILTERS, view: "missing" }} page={{ view: "missing", guests: MISSING_GUESTS }} />));
    expect(html).toContain('href="/admin/events/bcn-opening/guests?guest=amara-okafor&checkin=1"');
    expect(html).toContain("+234 803 555 0142");
  });

  it("loading renders skeleton rows", () => {
    const html = renderToStaticMarkup(<LogResults eventId={ID} summary={LOG_SUMMARY_LIVE} filters={DEFAULT_FILTERS} page={null} />);
    expect(html).toContain("aria-busy");
  });
});

describe("A-09b missing view: empty state", () => {
  const missing = { ...DEFAULT_FILTERS, view: "missing" as const };

  it("no verified guest is missing: the empty copy, not an empty table", () => {
    expect(logEmptyCopy(LOG_SUMMARY_LIVE, missing, 0)).toEqual({ title: "Everyone verified is in.", help: "Verified guests who haven’t checked in show up here." });
    const html = decode(renderToStaticMarkup(<LogResults eventId={ID} summary={LOG_SUMMARY_LIVE} filters={missing} page={{ view: "missing", guests: [] }} />));
    expect(html).toContain("Everyone verified is in.");
    expect(html).toContain("Verified guests who haven’t checked in show up here.");
    expect(html).not.toContain("checkin=1");
  });

  it("the missing empty copy wins over the before-doors copy, and rows suppress it", () => {
    expect(logEmptyCopy(LOG_SUMMARY_BEFORE, missing, 0)?.title).toBe("Everyone verified is in.");
    expect(logEmptyCopy(LOG_SUMMARY_LIVE, missing, 3)).toBeNull();
  });
});

describe("v5 rows open the shared drawer", () => {
  const albert: Scan = {
    id: "scn_a",
    at: "2026-10-23T19:50:00+02:00",
    result: "welcomed",
    guestName: "Albert Rosas",
    registrationId: "reg-albert",
    guestEmail: "albert@example.com",
    person: { photoUrl: "/api/admin/events/11111111-1111-1111-1111-111111111111/applicants/22222222-2222-2222-2222-222222222222/photo?v=3", verified: { verifiedAt: "2026-10-01T10:00:00Z", method: "Selfie liveness", emailVerifiedAt: null, createdAt: null }, timeZone: "Europe/Madrid" },
    doorId: "main-door",
    similarity: 97,
    latencyMs: 800,
  };
  const testUnknown: Scan = { id: "scn_t", at: "2026-10-23T19:51:00+02:00", result: "unknown", guestName: null, registrationId: null, doorId: "main-door", similarity: 55, latencyMs: 1200, test: true };

  it("a registered row links to ?guest=<registrationId>, keeping the filters; others to ?scan=<id>", () => {
    const f = { ...DEFAULT_FILTERS, door: "main-door" };
    expect(toLogRow(albert, LOG_SUMMARY_LIVE.doors, "Europe/Madrid", ID, f).href).toBe("/admin/events/bcn-opening/log?door=main-door&guest=reg-albert");
    expect(toLogRow(testUnknown, LOG_SUMMARY_LIVE.doors, "Europe/Madrid", ID, f).href).toBe("/admin/events/bcn-opening/log?door=main-door&scan=scn_t");
    // A name without a registration (fixtures, deleted registration) never opens a guest drawer.
    expect(toLogRow({ ...albert, registrationId: null }, LOG_SUMMARY_LIVE.doors, "Europe/Madrid", ID).href).toBe("/admin/events/bcn-opening/log?scan=scn_a");
    expect(logHref(ID, DEFAULT_FILTERS, { guest: "a b" })).toBe("/admin/events/bcn-opening/log?guest=a+b");
  });

  it("guest cell: photo, name, blue badge, and a keyboard-focusable link to the drawer", () => {
    const html = decode(renderToStaticMarkup(<LogResults eventId={ID} summary={LOG_SUMMARY_LIVE} filters={DEFAULT_FILTERS} page={{ view: "all", scans: [albert, testUnknown] }} />));
    expect(html).toContain('href="/admin/events/bcn-opening/log?guest=reg-albert"');
    expect(html).toContain("/applicants/22222222-2222-2222-2222-222222222222/photo?v=3");
    expect(html).toContain("Albert Rosas");
    // The unknown face: neutral avatar, its own link to the scan panel, and the TEST tag on a test scan.
    expect(html).toContain('aria-label="Unknown face"');
    expect(html).toContain('href="/admin/events/bcn-opening/log?scan=scn_t"');
    expect(html).toMatch(/>Test<\/span>/);
    expect(html).toContain('style="cursor:pointer"');
  });

  it("the blue badge streams in with the Guests tooltip (lazy, still server-rendered)", async () => {
    const { prerender } = await import("react-dom/static");
    const { prelude } = await prerender(<LogGuestCell row={toLogRow(albert, LOG_SUMMARY_LIVE.doors, "Europe/Madrid", ID)} />);
    const html = decode(await new Response(prelude).text());
    expect(html).toContain("Verified by Didit");
    expect(html).toContain('href="/admin/events/bcn-opening/log?guest=reg-albert"');
  });

  it("operators (no photo in the summary) get initials, never an img", () => {
    const html = renderToStaticMarkup(<LogResults eventId={ID} summary={LOG_SUMMARY_LIVE} filters={DEFAULT_FILTERS} page={{ view: "all", scans: [{ ...albert, person: { verified: albert.person!.verified!, timeZone: "Europe/Madrid" } }] }} />);
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-label="Albert Rosas"');
  });

  it("unknown-face panel: time, door, match, outcome, test flag, latency; Add as guest only with the capability", () => {
    const row = toLogRow(testUnknown, LOG_SUMMARY_LIVE.doors, "Europe/Madrid", ID);
    const html = decode(renderToStaticMarkup(<ScanDrawer row={row} date="23 Oct" closeHref="/x" addHref="/admin/events/bcn-opening/guests?add=1" inline />));
    for (const text of ["Scan", "Unknown face", "23 Oct · 19:51:00", "Main door", "55%", "Yes · nobody was admitted", "1.2s", "Add as guest"]) expect(html).toContain(text);
    expect(html).toContain('href="/admin/events/bcn-opening/guests?add=1"');
    expect(html).not.toContain("<img");
    const operator = renderToStaticMarkup(<ScanDrawer row={row} date="23 Oct" closeHref="/x" addHref={null} inline />);
    expect(operator).not.toContain("Add as guest");
  });

  it("the Test chip and filter: counts and rows agree", () => {
    const scans = [...LOG_SCANS, testUnknown, { ...albert, test: true }];
    const f = DEFAULT_FILTERS;
    const summary = { ...LOG_SUMMARY_LIVE, ...summarizeScans(scans, f) };
    const chips = logChips(ID, summary, f);
    expect(chips[0]!.label).toBe(`All ${filterScans(scans, f).length}`);
    expect(chips.at(-1)).toMatchObject({ key: "test", label: "Test 2", href: "/admin/events/bcn-opening/log?result=test" });
    expect(filterScans(scans, { ...f, result: "test" }).map((s) => s.id)).toEqual(["scn_t", "scn_a"]);
    expect(filterScans(scans, { ...f, result: "unknown" }).map((s) => s.id)).toEqual(["scn_07"]);
    expect(parseLogFilters({ result: "test" }).result).toBe("test");
    expect(logEmptyCopy(summary, { ...f, result: "test", door: "terrace" }, 0)?.help).toBe("No Test mode scans at Terrace yet.");
    // No test scans: no Test chip.
    expect(logChips(ID, LOG_SUMMARY_LIVE, f).some((c) => c.key === "test")).toBe(false);
  });
});
