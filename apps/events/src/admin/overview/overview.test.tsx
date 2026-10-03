import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OV_BEFORE, OV_EMPTY, OV_ENDED, OV_LIVE, OV_NOW_BEFORE, OV_NOW_ENDED, OV_NOW_LIVE, OV_REQUESTS } from "./fixtures";
import { banner, chart, funnel, isEmptyOverview, peak, phaseOf, tiles, untilLabel } from "./model";
import { OverviewLoading, OverviewView } from "./OverviewView";

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

describe("A-04 model", () => {
  it("live tiles match the design", () => {
    expect(tiles(OV_LIVE, "live").map((t) => [t.label, t.value, t.delta])).toEqual([
      ["Guests", "124", "118 links sent"],
      ["Verified", "98", "79% of guests"],
      ["Checked in", "42", "+8 in last 15 min"],
      ["Still missing", "56", "verified, not in"],
      ["Unknown faces", "3", "at Main door"],
    ]);
  });

  it("ended tiles and banner", () => {
    expect(tiles(OV_ENDED, "ended").map((t) => t.delta)).toEqual(["final", "88% of guests", "84% of guests", "verified, never in", "all at Main door"]);
    expect(banner(OV_ENDED, "ended", OV_NOW_ENDED)).toEqual({ text: "Ended at 23:00. 104 of 124 guests checked in (84%).", tone: "neutral" });
  });

  it("cancelled: CANCELLED before and after its date, with the reason; no no-shows tile, no \"Ended at\"", () => {
    const cancelled = { ...OV_BEFORE, status: "cancelled" as const, cancelReason: "Venue flooded" };
    for (const now of [OV_NOW_BEFORE, OV_NOW_LIVE, OV_NOW_ENDED, new Date("2030-01-01T00:00:00Z")]) expect(phaseOf(cancelled, now)).toBe("cancelled");
    expect(banner(cancelled, "cancelled", OV_NOW_BEFORE)).toEqual({ text: "This event was cancelled. Reason: Venue flooded", tone: "neutral" });
    expect(banner({ ...cancelled, cancelReason: " " }, "cancelled", OV_NOW_BEFORE)?.text).toBe("This event was cancelled.");
    const labels = tiles(cancelled, "cancelled").map((t) => t.label);
    expect(labels).toEqual(["Guests", "Verified", "Checked in", "Unknown faces"]);
    const html = decode(renderToStaticMarkup(<OverviewView data={cancelled} now={OV_NOW_ENDED} doorPanel />));
    expect(html).toContain("This event was cancelled. Reason: Venue flooded");
    for (const gone of ["Ended at", "No-shows", "Still missing", "Doors open in", "doors not open"]) expect(html).not.toContain(gone);
    // Nobody on it: the banner, not "Add guests".
    const empty = decode(renderToStaticMarkup(<OverviewView data={{ ...OV_EMPTY, status: "cancelled", cancelReason: "Venue flooded" }} now={OV_NOW_BEFORE} />));
    expect(empty).toContain("This event was cancelled. Reason: Venue flooded");
    expect(empty).not.toContain("Add guests");
  });

  it("before: doors countdown and kiosk line", () => {
    expect(phaseOf(OV_BEFORE, OV_NOW_BEFORE)).toBe("before");
    expect(banner(OV_BEFORE, "before", OV_NOW_BEFORE)?.text).toBe("Doors open in 2h 14m. Main door kiosk is paired and online.");
    expect(untilLabel(new Date("2026-10-23T18:15:00+02:00"), OV_BEFORE.startsAt)).toBe("45m");
  });

  it("a request-only event (nobody invited) counts its guests: tiles, percentages, funnel and banner", () => {
    expect(isEmptyOverview(OV_REQUESTS)).toBe(false);
    expect(tiles(OV_REQUESTS, "before").map((t) => [t.label, t.value, t.delta]).slice(0, 2)).toEqual([["Guests", "24", "3 requests pending"], ["Verified", "18", "75% of guests"]]);
    const done = { ...OV_REQUESTS, counts: { ...OV_REQUESTS.counts, pending: 0, checkedIn: 12 } };
    expect(tiles(done, "ended").map((t) => [t.value, t.delta]).slice(0, 4)).toEqual([["24", "final"], ["18", "75% of guests"], ["12", "50% of guests"], ["6", "verified, never in"]]);
    expect(banner(done, "ended", OV_NOW_ENDED)?.text).toBe("Ended at 23:00. 12 of 24 guests checked in (50%).");
    expect(funnel(OV_REQUESTS).map((f) => [f.value, f.pct])).toEqual([[24, 100], [24, 100], [18, 75], [0, 0]]);
  });

  it("empty only with no registration in any state and no open invitation", () => {
    const zero = OV_EMPTY.counts;
    expect(isEmptyOverview(OV_EMPTY)).toBe(true);
    // One pending request, one declined or cancelled registration, or one open invite: not empty, and no NaN / ÷0.
    for (const counts of [{ ...zero, pending: 1, registrations: 1 }, { ...zero, registrations: 1 }, { ...zero, invited: 1 }]) {
      const d = { ...OV_EMPTY, counts };
      expect(isEmptyOverview(d)).toBe(false);
      expect(tiles(d, "before").map((t) => t.delta).slice(0, 2)).toEqual([counts.pending ? "1 request pending" : counts.invited ? "1 invite open" : "0 links sent", "0% of guests"]);
      expect(funnel(d).map((f) => f.pct)).toEqual([0, 0, 0, 0]);
    }
  });

  it("funnel percentages and the chart peak / live bucket", () => {
    expect(funnel(OV_LIVE).map((f) => f.pct)).toEqual([100, 95, 79, 34]);
    const bars = chart(OV_LIVE, "live", OV_NOW_LIVE);
    expect(bars.map((b) => b.label)).toEqual(["18:45", "19:00", "19:15", "19:30", "19:45", "20:00", "20:15", "20:30", "20:45", "21:00", "21:15", "21:30"]);
    expect(bars.findIndex((b) => b.live)).toBe(4);
    expect(peak(bars)).toBe("17 at 19:30");
    expect(peak(chart(OV_ENDED, "ended", OV_NOW_ENDED))).toBe("21 at 19:45");
    expect(peak(chart(OV_BEFORE, "before", OV_NOW_BEFORE))).toBe("—");
  });
});

describe("A-04 render", () => {
  it("live: tiles, funnel, chart and the arrivals feed", () => {
    const html = decode(renderToStaticMarkup(<OverviewView data={OV_LIVE} now={OV_NOW_LIVE} />));
    expect(html).toContain("Arrivals · 15-minute buckets");
    expect(html).toContain("Peak 17 at 19:30");
    expect(html).toContain("María García");
    expect(html).toContain("Checked in at Main door");
    expect(html).toContain("LIVE");
    expect(html).not.toContain("Doors");
  });

  it("A-17: the door panel lists each kiosk with the new outcomes as chips", () => {
    const html = decode(renderToStaticMarkup(<OverviewView data={OV_LIVE} now={OV_NOW_LIVE} doorPanel />));
    for (const t of ["Two close matches", "Inconclusive", "Not admitted", "Liveness failed", "Strict", "Supervised", "Paused"]) expect(html).toContain(t);
  });

  it("before: empty feed; empty: add guests; loading: skeletons", () => {
    expect(renderToStaticMarkup(<OverviewView data={OV_BEFORE} now={OV_NOW_BEFORE} />)).toContain("No arrivals yet.");
    const empty = renderToStaticMarkup(<OverviewView data={OV_EMPTY} now={OV_NOW_BEFORE} />);
    expect(empty).toContain("No guests yet.");
    expect(empty).toContain('href="/admin/events/bcn-opening/guests?add=one"');
    expect(renderToStaticMarkup(<OverviewLoading />)).toContain('aria-busy="true"');
    const requests = decode(renderToStaticMarkup(<OverviewView data={OV_REQUESTS} now={OV_NOW_BEFORE} />));
    expect(requests).not.toContain("No guests yet.");
    for (const t of ["Guests", "24", "3 requests pending", "75% of guests", "Funnel"]) expect(requests).toContain(t);
  });
});

describe("A-04 arrivals chart on a phone", () => {
  const css = readFileSync(new URL("./Overview.module.css", import.meta.url), "utf8");
  it("bars and time labels share shrinkable columns, so the labels cannot widen the card", () => {
    expect(css).toMatch(/\.bars \{[^}]*grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.axis \{[^}]*grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
  });
  it("a narrow container shows every third label; the last one shown leaves two columns after it", () => {
    const phone = css.slice(css.indexOf("@container admin (max-width: 600px)"));
    expect(phone).toMatch(/\.axis span \{[^}]*visibility: hidden/);
    expect(phone).toMatch(/\.axis span:nth-child\(3n \+ 1\) \{ visibility: visible; \}/);
    const shown = chart(OV_LIVE, "live", OV_NOW_LIVE).map((b, i) => (i % 3 === 0 ? b.label : null)).filter(Boolean);
    expect(shown).toEqual(["18:45", "19:30", "20:15", "21:00"]);
  });
});
