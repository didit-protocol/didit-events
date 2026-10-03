import { describe, expect, it } from "vitest";
import { ADMIN_EVENTS } from "./fixtures";
import { countsLine, eventsHref, filterEvents, matchesQuery, parseQuery, parseStatus, statusChips, statusCounts } from "./filter";

const names = (rows: typeof ADMIN_EVENTS) => rows.map((e) => e.id);

describe("A-02 events list filter", () => {
  it("parseStatus: known chips only, first of repeated params, else all", () => {
    expect(parseStatus("live")).toBe("live");
    expect(parseStatus(["ended", "live"])).toBe("ended");
    expect(parseStatus("cancelled")).toBe("all");
    expect(parseStatus(undefined)).toBe("all");
    expect(parseStatus({ toString: () => "live" })).toBe("all");
  });

  it("a cancelled event keeps its own status and is listed and counted under Ended", () => {
    const rows = [...ADMIN_EVENTS, { ...ADMIN_EVENTS[0]!, id: "cancelled-one", status: "cancelled" as const }];
    expect(statusCounts(rows).ended).toBe(statusCounts(ADMIN_EVENTS).ended + 1);
    expect(statusCounts(rows).all).toBe(rows.length);
    const ended = filterEvents(rows, { q: "", status: "ended" });
    expect(names(ended)).toContain("cancelled-one");
    expect(ended.find((e) => e.id === "cancelled-one")!.status).toBe("cancelled");
    expect(names(filterEvents(rows, { q: "", status: "open" }))).not.toContain("cancelled-one");
  });

  it("parseQuery: trimmed, whitespace collapsed, capped at 100, strings only", () => {
    expect(parseQuery("  madrid \n  breakfast\t ")).toBe("madrid breakfast");
    expect(parseQuery(["lisbon", "x"])).toBe("lisbon");
    expect(parseQuery("x".repeat(150))).toHaveLength(100);
    expect(parseQuery(42)).toBe("");
    expect(parseQuery(undefined)).toBe("");
  });

  it("matchesQuery folds case and accents on both sides and needs every word", () => {
    const bcn = ADMIN_EVENTS[0]!;
    expect(matchesQuery(bcn, "")).toBe(true);
    expect(matchesQuery(bcn, "BARCELONA")).toBe(true);
    expect(matchesQuery(bcn, "bárcelona pallars")).toBe(true);
    expect(matchesQuery(bcn, "barcelona lisbon")).toBe(false);
    expect(matchesQuery({ ...bcn, name: "Café Łódź Évora" }, "cafe evora")).toBe(true);
    // the venue/address is searched too
    expect(matchesQuery(bcn, "carrer")).toBe(true);
  });

  it("filterEvents combines status and search", () => {
    expect(names(filterEvents(ADMIN_EVENTS, { q: "", status: "all" }))).toHaveLength(6);
    expect(names(filterEvents(ADMIN_EVENTS, { q: "", status: "open" }))).toEqual(["madrid-fintech-breakfast", "lisbon-roundtable"]);
    expect(names(filterEvents(ADMIN_EVENTS, { q: "lisbon", status: "open" }))).toEqual(["lisbon-roundtable"]);
    expect(names(filterEvents(ADMIN_EVENTS, { q: "lisbon", status: "ended" }))).toEqual([]);
    expect(names(filterEvents(ADMIN_EVENTS, { q: "barcelona", status: "all" }))).toEqual(["bcn-opening", "holiday-party-2026"]);
  });

  it("statusCounts counts every event regardless of the search", () => {
    expect(statusCounts(ADMIN_EVENTS)).toEqual({ all: 6, draft: 1, open: 2, live: 1, ended: 2 });
    expect(statusCounts([])).toEqual({ all: 0, draft: 0, open: 0, live: 0, ended: 0 });
  });

  it("eventsHref: only non-default params, the query encoded", () => {
    expect(eventsHref({})).toBe("/admin");
    expect(eventsHref({ status: "all" })).toBe("/admin");
    expect(eventsHref({ q: "café & co", status: "live" })).toBe("/admin?q=caf%C3%A9+%26+co&status=live");
  });

  it("statusChips keep the search, mark the current chip, and drop counts while loading", () => {
    const chips = statusChips("open", "madrid", statusCounts(ADMIN_EVENTS));
    expect(chips.map((c) => c.label)).toEqual(["All 6", "Draft 1", "Open 2", "Live 1", "Ended 2"]);
    expect(chips.find((c) => c.current)?.key).toBe("open");
    expect(chips.find((c) => c.key === "all")?.href).toBe("/admin?q=madrid");
    expect(chips.find((c) => c.key === "live")?.href).toBe("/admin?q=madrid&status=live");
    expect(statusChips("all", "").map((c) => c.label)).toEqual(["All", "Draft", "Open", "Live", "Ended"]);
  });

  it("countsLine", () => {
    expect(countsLine(ADMIN_EVENTS[0]!)).toBe("124 invited · 98 verified · 42 in");
  });
});
