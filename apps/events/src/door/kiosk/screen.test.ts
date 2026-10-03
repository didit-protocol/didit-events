import { describe, expect, it } from "vitest";
import { FIXTURE_OUTCOMES } from "./fixtures";
import { asTest, closedScreen, doorScreen, formatDoorsOpen, outcomeScreen, sessionScreen, type DoorState } from "./screen";

const door = { eventName: "Barcelona Office Opening", timeZone: "Europe/Madrid", threshold: 80, startsAt: "2026-10-08T18:30:00+02:00" };
const base: DoorState = { door, connection: { state: "online" }, closed: null, cameraError: null, detectorError: false, engine: null, stateMs: 0, overlayOpen: false };
const engine = (state: NonNullable<DoorState["engine"]>["state"], extra: Partial<NonNullable<DoorState["engine"]>> = {}) => ({ state, hint: null, progress: 0, ...extra });

describe("doorScreen", () => {
  it("idle → K-01 with the counter and no headline (the event name sits in the top bar); K-13 under the operator panel", () => {
    const idle = doorScreen(base);
    expect(idle).toMatchObject({ code: "K-01", kind: "oval", sub: "Look at the screen to check in", counter: true, tone: "idle" });
    expect(idle).not.toHaveProperty("head");
    const overlay = doorScreen({ ...base, overlayOpen: true });
    expect(overlay).toMatchObject({ code: "K-13", sub: "Look at the screen to check in" });
    expect(overlay).not.toHaveProperty("head");
  });

  it.each([
    ["too_far", "Move a little closer", "far"],
    ["too_close", "Step back a little", "near"],
    ["off_center", "Center your face", "off"],
    ["not_frontal", "Look at the screen", "on"],
    ["too_dark", "More light needed", "dim"],
    ["multiple_faces", "One person at a time", "on"],
  ] as const)("adjusting/%s → K-03 hint %s", (hint, copy, pose) => {
    const m = doorScreen({ ...base, engine: engine("adjusting", { hint }) });
    expect(m).toMatchObject({ code: "K-03", hint: copy, pose, tone: "face" });
  });

  it("adjusting without a face stays on K-01", () => {
    expect(doorScreen({ ...base, engine: engine("adjusting", { hint: "no_face" }) }).code).toBe("K-01");
  });

  it("holding → K-04 ring; verifying → K-05a then K-05b after 4 s", () => {
    expect(doorScreen({ ...base, engine: engine("holding", { progress: 0.62 }) })).toMatchObject({ code: "K-04", ring: 0.62, hint: "Hold still…", tone: "blue" });
    expect(doorScreen({ ...base, engine: engine("capturing") })).toMatchObject({ code: "K-05a", hint: "Checking…" });
    expect(doorScreen({ ...base, engine: engine("verifying"), stateMs: 3999 })).toMatchObject({ code: "K-05a", scan: true });
    expect(doorScreen({ ...base, engine: engine("verifying"), stateMs: 4000 })).toMatchObject({ code: "K-05b", hint: "Almost there…" });
  });

  it("precedence: session ended > offline > closed > camera error > detector > engine", () => {
    const offline = { state: "offline" as const, reason: "network" as const, retryInS: 5, lastOnline: "19:51" };
    expect(doorScreen({ ...base, session: "expired", connection: offline, closed: "ended" })).toMatchObject({ code: "D-02", head: "Door session expired" });
    expect(doorScreen({ ...base, connection: offline, closed: "not_started", cameraError: "in_use" })).toMatchObject({ code: "K-12c", chip: "Network offline · last online 19:51", sub: "No internet connection. Retrying in 5s" });
    expect(doorScreen({ ...base, closed: "not_started", cameraError: "in_use" })).toMatchObject({ code: "D-01a", head: "Doors open Thu 8 Oct, 18:30", cameraTone: "dim" });
    expect(doorScreen({ ...base, cameraError: "in_use" })).toMatchObject({ code: "K-02c", camera: "none" });
    expect(doorScreen({ ...base, detectorError: true, engine: engine("holding") })).toMatchObject({ code: "K-12a" });
    expect(doorScreen({ ...base, connection: { ...offline, reason: "budget" } })).toMatchObject({ code: "K-19" });
  });

  it.each([
    ["permission_denied", "K-02a", "Camera access needed"],
    ["not_found", "K-02b", "No camera found"],
    ["in_use", "K-02c", "Camera is busy"],
    ["unknown", "K-02b", "No camera found"],
  ] as const)("camera %s → %s", (error, code, head) => {
    expect(doorScreen({ ...base, cameraError: error })).toMatchObject({ code, head, camera: "none" });
  });

  it("K-12 outage variants round the countdown up", () => {
    const at = (reason: "service" | "credits" | "network") => doorScreen({ ...base, connection: { state: "offline", reason, retryInS: 11.2, lastOnline: null } });
    expect(at("service")).toMatchObject({ code: "K-12a", sub: "Retrying in 12s", head: "Check-in is temporarily unavailable" });
    expect(at("credits")).toMatchObject({ code: "K-12b", chip: "Out of Didit credits · top up in Console" });
    expect(at("network")).toMatchObject({ code: "K-12c", chip: "Network offline" });
  });
});

describe("outcomeScreen", () => {
  it.each([
    ["welcomed", { code: "K-06", kind: "welcome", hero: true, greeting: "Welcome,", name: "Maria García", sub: "Barcelona Office Opening", time: "Checked in at 19:42", cameraTone: "hero" }],
    ["welcome_back", { code: "K-07", hero: false, greeting: "Welcome back,", name: "Maria", sub: "You checked in at", time: "19:42" }],
    ["unknown", { code: "K-08", head: "We couldn’t find you", sub: "Please see the team at the desk.", chip: "No match above 80% · best 61%" }],
    ["not_on_list", { code: "K-09", head: "Hi Maria, you’re not on today’s list", chip: "Verified Didit user · not invited to this event" }],
    ["not_verified", { code: "K-10", icon: "…", iconTone: "feature", head: "Almost there, Maria", chip: "Status: In review" }],
    ["ambiguous", { code: "K-15", head: "Please see the team at the desk", chip: "Two close matches" }],
    ["inconclusive", { code: "K-16", chip: "Inconclusive" }],
    ["not_admitted", { code: "K-17", head: "Hi Maria, your place isn’t confirmed yet", sub: "The team at the desk can help.", chip: "Status: Waitlisted" }],
    ["liveness_failed", { code: "K-18", head: "We couldn’t confirm it’s you" }],
    ["budget_exhausted", { code: "K-19", chip: "Scan limit reached for today. Manual check-in only." }],
  ] as const)("%s", (key, expected) => {
    expect(outcomeScreen(FIXTURE_OUTCOMES[key], door)).toMatchObject(expected);
  });

  it("unknown without a best score, errors, no face, paused, and the verifying watchdog", () => {
    expect(outcomeScreen({ result: "unknown", threshold: 90, bestScore: null }, door)).toMatchObject({ chip: "No match above 90%" });
    expect(outcomeScreen({ result: "error", reason: "credits", retryInS: 30 }, door)).toMatchObject({ code: "K-12b", sub: "Retrying in 30s" });
    expect(outcomeScreen({ result: "no_face" }, door)).toMatchObject({ code: "K-03", hint: "Look at the screen" });
    expect(outcomeScreen({ result: "paused" }, door)).toMatchObject({ code: "K-11" });
    expect(outcomeScreen(FIXTURE_OUTCOMES.error, door)).toMatchObject({ code: "K-12a", chip: "Server error · ref req_4f2a9c" });
    expect(outcomeScreen({ kind: "timeout" }, door, 1500)).toMatchObject({ code: "K-12a", sub: "Retrying in 3s" });
  });

  it("result state renders the outcome, and falls back to idle without one", () => {
    const withResult = doorScreen({ ...base, engine: { state: "result", hint: null, progress: 0, result: FIXTURE_OUTCOMES.welcomed } });
    expect(withResult.code).toBe("K-06");
    expect(doorScreen({ ...base, engine: engine("result") }).code).toBe("K-01");
    expect(doorScreen({ ...base, engine: engine("cooldown") }).code).toBe("K-01");
  });
});

describe("the door inside Events: closed states, session end, Test mode", () => {
  it.each([
    ["not_started", "D-01a", "Doors open Thu 8 Oct, 18:30"],
    ["ended", "D-01b", "This event has ended"],
    ["cancelled", "D-01c", "This event was cancelled"],
    ["draft", "D-01d", "This event isn’t published yet"],
    ["face_off", "D-01e", "Face check-in is off for this event"],
  ] as const)("closed %s → %s says when or why and how to try it", (state, code, head) => {
    const screen = closedScreen(state, door);
    expect(screen).toMatchObject({ code, head });
    if (state !== "face_off") expect(screen).toMatchObject({ sub: expect.stringContaining("Test mode") });
    expect(doorScreen({ ...base, closed: state }).code).toBe(code);
  });
  it("doors-open time is in the event's zone", () => {
    expect(formatDoorsOpen("2026-10-08T16:30:00Z", "Europe/Madrid")).toBe("Thu 8 Oct, 18:30");
    expect(formatDoorsOpen("2026-10-08T16:30:00Z", "America/New_York")).toBe("Thu 8 Oct, 12:30");
  });
  it.each([["expired", "Door session expired"], ["ended", "Door mode ended"], ["revoked", "Door access was removed"]] as const)("session %s asks for a sign-in", (reason, head) => {
    expect(sessionScreen(reason)).toMatchObject({ code: "D-02", head });
  });
  it("Test mode labels every result as what would happen", () => {
    const welcome = doorScreen({ ...base, testMode: true, engine: { state: "result", hint: null, progress: 0, result: FIXTURE_OUTCOMES.welcomed_test } });
    expect(welcome).toMatchObject({ code: "K-06-test", greeting: "Test · Welcome,", sub: "Test mode: would be checked in. Nobody was." });
    expect(asTest(outcomeScreen(FIXTURE_OUTCOMES.not_admitted_rejected, door))).toMatchObject({ code: "K-17-test", chip: "Test mode · Status: Request declined" });
    expect(asTest(outcomeScreen({ result: "liveness_failed" }, door))).toMatchObject({ chip: "Test mode · Strict mode · liveness check not passed" });
    // A real result is never labelled.
    expect(doorScreen({ ...base, engine: { state: "result", hint: null, progress: 0, result: FIXTURE_OUTCOMES.welcomed } }).code).toBe("K-06");
  });
  it.each([["pending", "Request pending"], ["waitlisted", "Waitlisted"], ["rejected", "Request declined"], ["withdrawn", "Request withdrawn"], ["cancelled", "Place cancelled"], ["revoked", "Place revoked"]] as const)("not admitted (%s) names the status", (admission, label) => {
    expect(outcomeScreen({ result: "not_admitted", firstName: "Maria", admission }, door)).toMatchObject({ code: "K-17", chip: `Status: ${label}` });
  });
  it("a duplicate scan is a welcome back (no second email) even without a check-in time", () => {
    expect(outcomeScreen({ result: "welcome_back", firstName: "Maria", checkedInAt: null }, door)).toMatchObject({ code: "K-07", sub: "You’re already checked in" });
  });
});
