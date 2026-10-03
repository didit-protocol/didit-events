import { describe, expect, it } from "vitest";
import { STRICT_LIVENESS_MIN_FACE_PX as SERVER_MIN } from "@didit-events/core/door/service";
import type { FaceScan } from "../kiosk/types";
import { addArrival, announcement, arrivalOf, initials, resultChip, tagView } from "./tags";
import { STRICT_LIVENESS_MIN_FACE_PX } from "./useLiveDoor";

const compact = { verified: true, verifiedAt: "2026-09-30T10:00:00.000Z", photo: "none" as const, trackId: 1 };
const welcome: FaceScan = { result: "welcomed", fullName: "Albert Rosas", firstName: "Albert", checkedInAt: "2026-10-01T18:00:00.000Z", test: false, outcome: "welcome", displayName: "Albert Rosas", ...compact };

describe("AR tag view", () => {
  it("shows name, badge and a green chip for a check-in", () => {
    expect(tagView({ state: "done", scan: welcome })).toEqual({ kind: "result", name: "Albert Rosas", verified: true, chip: { text: "Checked in", tone: "green" } });
  });
  it.each([
    [{ result: "welcome_back", firstName: "Albert", checkedInAt: null, test: false, outcome: "welcome_back", displayName: "Albert Rosas", ...compact }, "Welcome back", "green"],
    [{ result: "not_on_list", firstName: "Albert", test: false, outcome: "not_on_list", displayName: "Albert Rosas", ...compact }, "Not on the list", "amber"],
    [{ result: "not_admitted", firstName: "Albert", admission: "pending", test: false, outcome: "not_approved", displayName: "Albert Rosas", ...compact }, "Request pending", "amber"],
    [{ result: "unknown", threshold: 80, bestScore: null, test: false, outcome: "unknown", firstName: null, displayName: null, verified: false, verifiedAt: null }, "Unknown", "gray"],
    [{ ...welcome, test: true, outcome: "test" }, "Test", "blue"],
    [{ result: "ambiguous", test: false }, "Two close matches — see the desk", "gray"],
    [{ result: "inconclusive", test: false }, "Couldn't confirm who this is — see the desk", "gray"],
    [{ result: "no_face", test: false }, "Couldn't read your face — step closer", "gray"],
    [{ result: "error", reason: "service", retryInS: 5, test: false }, "Couldn't check — trying again", "gray"],
    [{ result: "liveness_needed", test: false, outcome: "liveness_needed", firstName: null, displayName: null, verified: false, verifiedAt: null }, "Come closer for the face check", "amber"],
  ] as Array<[FaceScan, string, string]>)("%o → %s", (scan, text, tone) => {
    expect(resultChip(scan)).toEqual({ text, tone });
  });
  it("names only recognised people; unknown faces get no name and no badge", () => {
    expect(tagView({ state: "done", scan: { result: "unknown", threshold: 80, bestScore: null, test: false } })).toEqual({ kind: "result", name: undefined, verified: false, chip: { text: "Unknown", tone: "gray" } });
    expect(tagView({ state: "done", scan: { ...welcome, verified: false } }).verified).toBe(false);
  });
  it("checking, offline and guidance states", () => {
    expect(tagView({ state: "checking" })).toEqual({ kind: "checking" });
    expect(tagView({ state: "offline" })).toEqual({ kind: "offline", chip: { text: "Offline", tone: "gray" } });
    expect(tagView({ state: "idle", guidance: "More light needed" })).toEqual({ kind: "guidance", guidance: "More light needed" });
    expect(tagView({ state: "idle" })).toEqual({ kind: "none" });
  });
  it("the client's strict-distance gate matches the server's", () => {
    expect(STRICT_LIVENESS_MIN_FACE_PX).toBe(SERVER_MIN);
  });
});

describe("Arrivals rail", () => {
  it("keeps the last 8 check-ins newest first; a re-scan moves the person up instead of repeating", () => {
    let list = Array.from({ length: 9 }, (_, i) => arrivalOf({ ...welcome, displayName: `Guest ${i}` }, i)!).reduce((l, a) => addArrival(l, a), [] as ReturnType<typeof addArrival>);
    expect(list).toHaveLength(8);
    expect(list[0]!.name).toBe("Guest 8");
    list = addArrival(list, arrivalOf({ ...welcome, result: "welcome_back", displayName: "Guest 3" }, 100)!);
    expect(list[0]).toMatchObject({ name: "Guest 3", label: "Welcome back" });
    expect(list.filter((a) => a.name === "Guest 3")).toHaveLength(1);
  });
  it("only check-ins (and Test-mode would-be ones) arrive", () => {
    expect(arrivalOf({ result: "not_on_list", firstName: "A", test: false }, 1)).toBeNull();
    expect(arrivalOf({ ...welcome, test: true }, 1)).toMatchObject({ label: "Test", tone: "blue" });
  });
  it("initials and announcements", () => {
    expect(initials("albert rosas maría")).toBe("AR");
    expect(initials(" ")).toBe("?");
    expect(announcement(welcome)).toBe("Welcome, Albert Rosas. Checked in.");
    expect(announcement({ ...welcome, test: true })).toContain("Nobody was checked in");
    expect(announcement({ result: "unknown", threshold: 80, bestScore: null })).toBeNull();
  });
});
