import { describe, expect, it } from "vitest";
import { agendaItems } from "./lifecycle.ts";

describe("M-11 agenda items", () => {
  it("reads the editor's {at,label} instants as HH:mm in the event's zone, keeps older shapes, drops the rest", () => {
    const stored = [{ at: "2026-10-23T17:00:00.000Z", label: "Doors" }, { time: "20:00", title: "Welcome" }, { t: "21:00", l: "Drinks" }, { at: "nope", label: "x" }, { bogus: true }, null];
    expect(agendaItems(stored, "Europe/Madrid")).toEqual([{ t: "19:00", l: "Doors" }, { t: "20:00", l: "Welcome" }, { t: "21:00", l: "Drinks" }]);
    expect(agendaItems([{ at: "2026-10-23T17:00:00.000Z", label: "Doors" }], "America/New_York")).toEqual([{ t: "13:00", l: "Doors" }]);
    expect(agendaItems(Array.from({ length: 40 }, (_, i) => ({ t: "20:00", l: `Item ${i}` })), "UTC")).toHaveLength(30);
    expect(agendaItems("x", "UTC")).toEqual([]);
  });
});
