import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { C00Components } from "./C00";
import { DatePicker, NumberField, TimeField, Combobox, normalizeTime } from "../index";

describe("C-00 pickers", () => {
  it("the gallery shows the date picker (closed states + open grid), time field, stepper and combobox", () => {
    const html = renderToStaticMarkup(<C00Components />);
    expect(html).toContain("Pick a date");
    expect(html).toContain("Fri, 23 Oct 2026");
    expect(html.match(/aria-haspopup="dialog"/g)!.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('role="grid"');
    expect(html).toContain("October 2026");
    expect(html).toMatch(/data-date="2026-10-04"[^>]*aria-disabled="true"/);
    expect(html).toMatch(/data-date="2026-10-23"[^>]*data-selected=""/);
    expect(html).toContain('role="combobox"');
    expect(html).toContain("3 h 30 min");
    expect(html).toContain('value="1,200"');
    expect(html).toContain("UTC+02:00");
  });
  it("is exported from @didit-events/ui", () => {
    expect([DatePicker, NumberField, TimeField, Combobox].every((c) => typeof c === "function")).toBe(true);
    expect(normalizeTime("7pm")).toBe("19:00");
  });
});
