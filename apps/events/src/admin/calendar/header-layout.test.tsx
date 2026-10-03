import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarProfileRow } from "@didit-events/core/calendar";
import { CalendarHeader } from "../../public/components/CalendarHeader";
import { calendarProfile } from "../../public/calendar-profile";
import { CalendarProfileForm } from "./CalendarProfileForm";
import { calendarAdminModel } from "./model";

const idle = async () => ({ status: "idle" as const, values: calendarAdminModel(null).values });
const noop = async () => ({});
const row = (logo: boolean): CalendarProfileRow => ({ name: "Founders Club", tagline: "AI, startups and identity", description: "Bio", coverType: null, coverVersion: 0, logoType: logo ? "image/png" : null, logoVersion: 3, websiteUrl: null, xUrl: null, linkedinUrl: null, updatedAt: new Date("2026-09-01T10:00:00Z"), updatedBy: "owner@didit.me" });
const form = (r: CalendarProfileRow | null, counts?: { subscribers: number; events: number }) =>
  renderToStaticMarkup(<CalendarProfileForm model={calendarAdminModel(r)} save={idle} upload={noop} remove={noop} counts={counts} />);
const preview = (html: string) => html.slice(html.indexOf('aria-label="Public page preview"'), html.indexOf("</section>"));

/** The declarations of one rule (`.a` or `.a[data-x]`) in a CSS file, as a property map. */
const css = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const rule = (source: string, selector: string) => {
  const esc = selector.replace(/[.[\]"=-]/g, (c) => `\\${c}`);
  const body = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(source)?.[1];
  if (body === undefined) return null;
  return Object.fromEntries(body.split(";").map((d) => d.split(":").map((x) => x.trim())).filter(([k, v]) => k && v));
};
const page = css("../../public/components/CalendarPage.module.css");
const px = (v: string) => Number(/^(-?\d+)px$/.exec(v)?.[1]);

describe("calendar header layout (public page and /admin/calendar preview)", () => {
  it("one self-contained header: banner with the tile, then the text block with the tagline first", () => {
    const html = renderToStaticMarkup(<CalendarHeader profile={calendarProfile(row(false))} />);
    expect(html).toMatch(/^(<link[^>]*>)?<header class="header"><div class="banner"[^>]*><span class="mark">/);
    expect(html).toMatch(/<\/div><div class="host"><div class="hostText"><span class="tagline">AI, startups and identity<\/span>/);
    expect(preview(form(row(false)))).toContain('<header class="header">');
  });
  it("the text block starts below the tile's overhang, with room to spare (no overlap in any container)", () => {
    const mark = rule(page, ".mark")!;
    const overhang = -px(mark.bottom);
    expect(overhang).toBe(32);
    const host = rule(page, ".host")!;
    expect(px(host["padding-top"]) - overhang).toBeGreaterThanOrEqual(16);
    // The header is its own column: the preview frame adds no gap the layout could depend on.
    expect(rule(page, ".header")).toMatchObject({ display: "flex", "flex-direction": "column" });
  });
  it("the preview stats show the public page's real numbers, or no line at all", () => {
    const withCounts = preview(form(row(false), { subscribers: 1240, events: 7 }));
    expect(withCounts).toContain("1,240 subscribers · 7 events");
    const without = preview(form(row(false)));
    expect(without).not.toMatch(/subscribers|Subscribers/);
    expect(form(null)).not.toContain("Subscribers · events");
  });
});

describe("logo tiles are transparent", () => {
  it("calendar header tile: white behind transparent logos, raised above the host block", () => {
    expect(rule(page, ".mark")!.background).toBe("var(--white)");
    expect(rule(page, ".mark")!["z-index"]).toBe("2");
    expect(rule(page, ".mark[data-custom]")).toBeNull();
    const custom = renderToStaticMarkup(<CalendarHeader profile={calendarProfile(row(true))} />);
    expect(custom).toMatch(/<span class="mark" data-custom=""><img src="\/api\/calendar\/logo\?v=3"/);
    const builtIn = renderToStaticMarkup(<CalendarHeader profile={calendarProfile(null)} />);
    expect(builtIn).toMatch(/<span class="mark"><img[^>]*class="markImg"/);
  });
  it("event page \"Presented by\" tile is transparent", () => {
    const event = css("../../public/components/EventPage.module.css");
    expect(rule(event, ".presenterMark")!.background).toBe("transparent");
  });
  it("/admin/calendar logo slot: transparent, and the built-in Didit mark (not a black box) when nothing is uploaded", () => {
    const admin = css("./Calendar.module.css");
    expect(rule(admin, '.slot[data-kind="logo"] .slotImage')!.background).toBe("transparent");
    const html = form(row(false));
    const slot = html.slice(html.indexOf('data-kind="logo"'));
    expect(slot).toMatch(/<img[^>]*alt="Didit mark"[^>]*class="slotMark"/);
  });
});
