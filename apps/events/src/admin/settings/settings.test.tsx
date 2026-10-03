import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeleteEventDialog } from "./DeleteEventDialog";
import { questionCount, validateDetails } from "./details";
import { DetailsForm } from "./DetailsForm";
import { BCN_SETTINGS } from "./fixtures";
import { parseLimits, scansToday, usage } from "./limits";
import { SettingsView } from "./SettingsView";

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const noop = () => {};

describe("A-18 limits", () => {
  it("accepts a valid budget, mode and strictness", () => {
    expect(parseLimits({ budget: "600", mode: "strict", strictness: "90" }, 12)).toEqual({ ok: true, limits: { dailyScanBudget: 600, scansToday: 12, mode: "strict", strictness: 90 } });
  });

  it("rejects out-of-range budgets and unknown presets", () => {
    const r = parseLimits({ budget: "10", mode: "loose", strictness: "59" }, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["budget", "mode", "strictness"]);
    expect(parseLimits({ budget: "1e3", mode: "supervised", strictness: "80" }, 0).ok).toBe(false);
  });

  it("tones the usage bar at 80% and at the cap", () => {
    expect(usage(BCN_SETTINGS.limits)).toEqual({ text: "186 of 500 scans today", tone: "ok" });
    expect(usage({ ...BCN_SETTINGS.limits, scansToday: 400 }).tone).toBe("warn");
    expect(usage({ ...BCN_SETTINGS.limits, scansToday: 500 }).tone).toBe("full");
  });

  it("counts only today's real scans in the event's zone; test scans never spend the budget", () => {
    const now = new Date("2026-06-10T21:30:00Z"); // 23:30 in Madrid
    const scans = [
      { createdAt: new Date("2026-06-10T08:00:00Z"), test: false },
      { createdAt: new Date("2026-06-10T21:00:00Z"), test: true },
      { createdAt: new Date("2026-06-10T21:59:00Z"), test: false }, // 23:59 Madrid, still today
      { createdAt: new Date("2026-06-09T21:59:00Z"), test: false }, // yesterday in Madrid
    ];
    expect(scansToday("Europe/Madrid", scans, now)).toBe(2);
  });
});

describe("A-11 Settings", () => {
  it("counts questions in the singular and the plural", () => {
    expect([0, 1, 2, 20].map(questionCount)).toEqual(["0 questions", "1 question", "2 questions", "20 questions"]);
  });

  it("renders every section with the design copy", () => {
    const html = decode(renderToStaticMarkup(<SettingsView settings={BCN_SETTINGS} />));
    for (const t of ["Event details", "Request form", "Welcome email", "Spend and limits", "Danger zone", "Edit all details", "Stops all kiosks and locks the check-in log.", "Removes guests, links and logs. Didit sessions stay in Didit."]) expect(html).toContain(t);
    expect(html).toContain("New guests join the waitlist when all 150 places are taken.");
    expect(html).toContain('value="Welcome to Barcelona Office Opening, {first_name}"');
    expect(html).toContain("186 of 500 scans today");
    expect(html).toContain('href="/admin/events/bcn-opening/edit"');
  });

  it("an ended event cannot be ended again", () => {
    expect(renderToStaticMarkup(<SettingsView settings={{ ...BCN_SETTINGS, ended: true }} />)).toMatch(/<button[^>]*disabled=""[^>]*>Ended<\/button>/);
  });

  it("A-11b: Delete stays disabled until the exact name is typed", () => {
    const partial = decode(renderToStaticMarkup(<DeleteEventDialog eventId="bcn-opening" name="Barcelona Office Opening" guestCount={124} open inline typed="Barcelona Office Open" onClose={noop} />));
    expect(partial).toContain("This removes 124 guests, their links and the check-in log. It can't be undone.");
    expect(partial).toMatch(/<button[^>]*disabled=""[^>]*>Delete event<\/button>/);
    const exact = renderToStaticMarkup(<DeleteEventDialog eventId="bcn-opening" name="Barcelona Office Opening" guestCount={124} open inline typed="Barcelona Office Opening" onClose={noop} />);
    expect(exact).not.toMatch(/<button[^>]*disabled=""[^>]*>Delete event<\/button>/);
  });

  it("Event details: editable name, the editor's date picker and time fields, the edit version on every form", () => {
    // SettingsView loads the editor as its own chunk; it server-renders the same DetailsForm.
    expect(decode(renderToStaticMarkup(<SettingsView settings={BCN_SETTINGS} />)).match(/name="expectedVersion" value="4"/g)?.length).toBe(2);
    const html = decode(renderToStaticMarkup(<DetailsForm eventId="bcn-opening" initial={BCN_SETTINGS.details!} editVersion={4} />));
    expect(html).toContain('value="Barcelona Office Opening"');
    expect(html).not.toMatch(/<input[^>]*readOnly=""[^>]*value="Barcelona Office Opening"/i);
    expect(html).toContain("Fri, 23 Oct 2026");
    expect(html).toContain('value="19:00"');
    expect(html).toContain('value="23:00"');
    expect(html).toContain("Times are in Europe/Madrid.");
  });

  it("Event details validation matches the editor: end after start, same day", () => {
    expect(validateDetails({ name: "A", date: "2026-10-23", start: "19:00", end: "23:00" })).toEqual({});
    expect(validateDetails({ name: "A", date: "2026-10-23", start: "19:00", end: "19:00" }).end).toBe("End must be after start");
    expect(validateDetails({ name: "A", date: "2026-10-23", start: "19:00", end: "18:00" }).end).toContain("can’t run past midnight");
    expect(validateDetails({ name: " ", date: "2026-13-40", start: "x", end: "" })).toEqual({ name: "Give the event a name", date: "Pick a valid date", start: "Use a time like 19:00", end: "Add an end time" });
  });
});

