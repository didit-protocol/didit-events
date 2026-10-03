import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarProfileRow } from "@didit-events/core/calendar";
import { CalendarHeader } from "../../public/components/CalendarHeader";
import { calendarProfile, DEFAULT_CALENDAR_PROFILE } from "../../public/calendar-profile";
import { CalendarProfileForm } from "./CalendarProfileForm";
import { calendarAdminModel } from "./model";
import s from "../../public/components/CalendarPage.module.css";

const idle = async () => ({ status: "idle" as const, values: calendarAdminModel(null).values });
const noop = async () => ({});
const row = (tagline: string): CalendarProfileRow => ({ name: "Founders Club", tagline, description: "Bio", coverType: null, coverVersion: 0, logoType: null, logoVersion: 0, websiteUrl: null, xUrl: null, linkedinUrl: null, updatedAt: new Date("2026-09-01T10:00:00Z"), updatedBy: "owner@didit.me" });
const taglineSpan = (html: string) => new RegExp(`<span class="${s.tagline}">([^<]*)</span>`).exec(html)?.[1] ?? null;
const preview = (r: CalendarProfileRow | null) => {
  const html = renderToStaticMarkup(<CalendarProfileForm model={calendarAdminModel(r)} save={idle} upload={noop} remove={noop} />);
  return html.slice(html.indexOf('aria-label="Public page preview"'), html.indexOf("</section>"));
};
const publicHeader = (r: CalendarProfileRow | null) => renderToStaticMarkup(<CalendarHeader profile={calendarProfile(r)} />);

describe("/admin/calendar preview matches the public header", () => {
  it("no profile row: the tagline is hidden in both (and the editor starts empty, so saving keeps it hidden)", () => {
    expect(taglineSpan(publicHeader(null))).toBeNull();
    expect(taglineSpan(preview(null))).toBeNull();
    expect(preview(null)).not.toContain(DEFAULT_CALENDAR_PROFILE.tagline);
    expect(calendarAdminModel(null).values.tagline).toBe("");
    expect(calendarAdminModel(null).hasRow).toBe(false);
  });
  it("with a row: same tagline shown (or hidden when empty) in both", () => {
    for (const tagline of ["Evenings for builders", ""]) {
      const expected = tagline || null;
      expect(taglineSpan(publicHeader(row(tagline)))).toBe(expected);
      expect(taglineSpan(preview(row(tagline)))).toBe(expected);
    }
  });
});
