import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CalendarProfileRow } from "@didit-events/core/calendar";
import { calendarAdminModel } from "./model";

const css = readFileSync(new URL("./Calendar.module.css", import.meta.url), "utf8");
const form = readFileSync(new URL("./CalendarProfileForm.tsx", import.meta.url), "utf8");
const ROW: CalendarProfileRow = { name: "Founders Club", tagline: "AI", description: "Bio", coverType: null, coverVersion: 0, logoType: null, logoVersion: 0, websiteUrl: null, xUrl: null, linkedinUrl: null, updatedAt: new Date("2026-09-30T20:12:00Z"), updatedBy: "owner@didit.me" };

describe("/admin/calendar, responsive and hydration", () => {
  it("'Last saved' is formatted once, on the server, in the admin time zone", () => {
    const month = new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date("2026-09-01"));
    expect(calendarAdminModel(ROW).updatedAtLabel).toBe(`30 ${month} 2026, 22:12`);
    expect(calendarAdminModel(null).updatedAtLabel).toBeNull();
    // The client component prints the label; it never formats a date during render.
    expect(form).not.toContain("toLocaleString");
    expect(form).toContain("model.updatedAtLabel");
  });

  it("the slots and links stack by the page box's width (its own size container)", () => {
    expect(css).toContain(".page { container: calendar / inline-size; }");
    expect(css).not.toContain("@container admin");
    const narrow = css.slice(css.indexOf("@container calendar (max-width: 640px)"));
    expect(narrow).toContain(".slots, .linksGrid { grid-template-columns: minmax(0, 1fr); }");
    expect(narrow).toContain("font-size: 16px");
  });
});
