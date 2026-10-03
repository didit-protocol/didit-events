import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eligible, eligibility, type EvidenceAccount, type EvidenceFact } from "./eligibility.ts";
import { doorEligibility, resolveFaceMatches, type DoorEvent, type FaceLookups } from "./door.ts";
import { displayStatus, type EvidenceSummary, type StatusEvent, type StatusRegistration } from "./display-status.ts";
import { canTransition, canTransitionGuest, type Admission } from "./transitions.ts";
import { STATUS_MODEL, type DesignStatus } from "./status-model.ts";
import { doorService as implementedDoorService } from "../door/service.ts";
import { doorService, eventService, admissionService, inviteService } from "./services.ts";
import { Events } from "../admission/events.ts";
import { Admissions } from "../admission/admission.ts";
import { Invites } from "../admission/invites.ts";
import type { FaceMatch } from "../didit/types.ts";
import { requirementsSchema, maxAgeSchema } from "./requirements.ts";
const now = new Date("2026-09-29T12:00:00Z"), day = 86400_000;
const event: DoorEvent = { id: "event", startsAt: new Date(now.getTime() - 3600_000), endsAt: new Date(now.getTime() + 3600_000), status: "live", doorMode: "supervised", requirements: { identity: true, email: true, liveness: true }, maxAge: {} };
const evidence = (kind: EvidenceFact["kind"], changes: Partial<EvidenceFact> = {}): EvidenceFact => ({ id: kind, accountId: "a", verificationId: "verification", kind, establishedAt: new Date(now.getTime() - day), validUntil: new Date(now.getTime() + day * 179), invalidatedAt: null, supersededAt: null, state: "active", activation: "active", providerStatus: "approved", invalidatedReason: null, recoveredBy: null, recoveryReason: null, continuityOf: null, value: kind === "age" ? 18 : null, ...changes });
const account = (changes: Partial<EvidenceAccount> = {}): EvidenceAccount => ({ id: "a", deletingAt: null, deletedAt: null, evidence: [evidence("identity"), evidence("face"), evidence("age")], ...changes });
const registration = { id: "registration", accountId: "a", eventId: "event", admission: "approved" as const };
const kiosk = { id: "kiosk", eventId: "event", revokedAt: null };
const match = (session: string, score: number, extra: Partial<FaceMatch> = {}): FaceMatch => ({ session_id: session, similarity_percentage: score, is_blocklisted: false, api_service: null, status: "Approved", ...extra });
const lookups = (): FaceLookups => ({ event, now, bySession: new Map([["s", { account: account(), verificationId: "verification", faceEvidenceId: "face", registration, activeCheckin: false }]]) });

describe("C15 eligibility and C18 door", () => {
  it.each([[17.99, false], [18, true], [18.01, true]])("age %s at minimum 18 -> %s", (value, expected) => {
    expect(eligible(account({ evidence: [evidence("identity"), evidence("face"), evidence("age", { value })] }), { ...event, ageMin: 18 })).toBe(expected);
  });
  it.each([-1, 0, 1])("default TTL boundary offset %s ms", offset => {
    const establishedAt = new Date(event.endsAt.getTime() - 180 * day + offset);
    expect(eligible(account({ evidence: [evidence("identity"), evidence("face", { establishedAt, validUntil: new Date(event.endsAt.getTime() + day) })] }), event)).toBe(offset > 0);
  });
  it.each([-1, 0, 1])("tightened freshness boundary offset %s ms", offset => {
    expect(eligible(account({ evidence: [evidence("identity"), evidence("face", { establishedAt: new Date(event.endsAt.getTime() - 86400_000 + offset) })] }), { ...event, maxAge: { face: 86400 } })).toBe(offset >= 0);
  });
  it.each(["invalidated", "pending_continuity", "superseded"] as const)("excludes %s evidence", state => {
    expect(eligible(account({ evidence: [evidence("identity"), evidence("face", { state, activation: state === "invalidated" ? "revoked" : state })] }), event)).toBe(false);
  });
  it("requires valid_until strictly past event end, account ownership and deleting gate", () => {
    expect(eligible(account({ evidence: [evidence("identity"), evidence("face", { validUntil: event.endsAt })] }), event)).toBe(false);
    expect(eligible(account({ evidence: [evidence("identity"), evidence("face", { accountId: "foreign" })] }), event)).toBe(false);
    expect(eligible(account({ deletingAt: now }), event)).toBe(false);
    expect(eligibility(account({ evidence: [evidence("identity")] }), event).missing).toEqual(["identity", "face"]);
    expect(requirementsSchema.safeParse({ liveness: "true" }).success).toBe(false);
    expect(maxAgeSchema.safeParse({ face: 181 * 86400 }).success).toBe(false);
  });
  it("door rechecks exact face proof, deletion, admission, kiosk, event and strict liveness", () => {
    const input = { account: account(), event, registration, kiosk, faceEvidenceId: "face", now };
    expect(doorEligibility(input)).toEqual({ eligible: true });
    expect(doorEligibility({ ...input, event: { ...event, startsAt: new Date(now.getTime() + 1800_000) } })).toEqual({ eligible: true }); // Live doors may open before the agenda starts.
    expect(doorEligibility({ ...input, faceEvidenceId: "replaced" })).toEqual({ eligible: false, result: "not_verified" });
    expect(doorEligibility({ ...input, account: account({ deletingAt: now }) })).toEqual({ eligible: false, result: "unknown" });
    expect(doorEligibility({ ...input, registration: { ...registration, admission: "revoked" } })).toEqual({ eligible: false, result: "not_admitted" });
    expect(doorEligibility({ ...input, kiosk: { ...kiosk, revokedAt: now } })).toEqual({ eligible: false, result: "paused" });
    // Test mode answers what would happen before the start and after the end; the caller never admits on it.
    expect(doorEligibility({ ...input, now: event.endsAt, test: true })).toEqual({ eligible: true });
    expect(doorEligibility({ ...input, event: { ...event, status: "cancelled" }, test: true })).toEqual({ eligible: true });
    expect(doorEligibility({ ...input, event: { ...event, door: { kiosk: false } }, test: true })).toEqual({ eligible: false, result: "paused" });
    expect(doorEligibility({ ...input, event: { ...event, status: "cancelled" } })).toEqual({ eligible: false, result: "paused" });
    expect(doorEligibility({ ...input, now: event.endsAt })).toEqual({ eligible: false, result: "paused" });
    expect(doorEligibility({ ...input, event: { ...event, doorMode: "strict" } })).toEqual({ eligible: false, result: "liveness_failed" });
    expect(doorEligibility({ ...input, event: { ...event, doorMode: "strict" }, strictLivenessPassed: true })).toEqual({ eligible: true });
  });
});
describe("C8 face match resolution", () => {
  it("a full page with one local account resolves to it despite foreign, blocked and API matches", () => {
    const matches = [match("s", 99), match("foreign", 96), match("blocked", 90, { is_blocklisted: true }), match("api", 86, { api_service: "FACE_SEARCH" }), match("last", 80)];
    expect(resolveFaceMatches(matches, lookups(), 80).result).toBe("welcomed");
    expect(resolveFaceMatches([...matches.slice(0, 4), match("last", 79.99)], lookups(), 80).result).toBe("welcomed");
    expect(resolveFaceMatches([...matches, match("sixth", 80)], lookups(), 80)).toEqual({ result: "inconclusive" });
  });
  // A door-lab scan: five matches, all the same person (enrolled several times), one session with no local account.
  const alberto = [match("a1a1a1a1", 78.3), match("b2b2b2b2", 76.9), match("s3", 76.5), match("s4", 75.9), match("s5", 73.6)];
  const other = account({ id: "b", evidence: account().evidence.map(e => ({ ...e, accountId: "b" })) });
  const sessions = (own: string[], others: string[] = []): FaceLookups => {
    const base = lookups(), lookup = base.bySession.get("s")!;
    return { ...base, bySession: new Map([...own.map(s => [s, lookup] as const), ...others.map(s => [s, { ...lookup, account: other, registration: null }] as const)]) };
  };
  it.each([
    ["real candidates at 65: unknown 78.3 leads the account by 1.4", alberto, sessions(["b2b2b2b2", "s3", "s4", "s5"]), 65, "welcomed"],
    ["the same candidates at 50", alberto, sessions(["b2b2b2b2", "s3", "s4", "s5"]), 50, "welcomed"],
    ["one account enrolled five times", alberto, sessions(["a1a1a1a1", "b2b2b2b2", "s3", "s4", "s5"]), 65, "welcomed"],
    ["a second local account on a full page (2026-10-02: the closest wins, no desk)", alberto, sessions(["b2b2b2b2", "s3", "s4"], ["s5"]), 65, "welcomed"],
    ["a second local account far below the best on a full page", [match("s", 95), match("s2", 94), match("s3", 93), match("s4", 92), match("b1", 70)], sessions(["s", "s2", "s3", "s4"], ["b1"]), 65, "welcomed"],
    ["an unknown session more than five points above the best account is ignored", [match("x", 90), match("s", 84.9), match("s2", 80), match("s3", 79), match("s4", 78)], sessions(["s", "s2", "s3", "s4"]), 65, "welcomed"],
    ["an unknown session exactly five points above the best account", [match("x", 90), match("s", 85), match("s2", 80), match("s3", 79), match("s4", 78)], sessions(["s", "s2", "s3", "s4"]), 65, "welcomed"],
    ["only unknown sessions", alberto, sessions([]), 65, "unknown"],
    ["a full page whose 5th is below threshold keeps the plain rules", [match("x", 99), match("s", 80), match("s2", 70), match("s3", 66), match("s4", 64)], sessions(["s", "s2", "s3", "s4"]), 65, "welcomed"],
  ] as const)("full page: %s", (_name, matches, rows, threshold, result) => {
    expect(resolveFaceMatches([...matches], rows, threshold).result).toBe(result);
  });
  it.each([[50, true], [65, true], [99, true], [49, false], [100, false], [Number.NaN, false]])("threshold %s accepted: %s", (threshold, ok) => {
    const run = () => resolveFaceMatches([match("s", 99.5)], lookups(), threshold);
    if (ok) expect(run().result).toBe("welcomed"); else expect(run).toThrow("InvalidMatchThreshold");
  });
  it.each([[], [match("foreign", 99)], [match("s", 79)], [match("s", 95, { is_blocklisted: true })], [match("s", 95, { api_service: "PASSIVE_LIVENESS" })], [match("s", 95, { status: "Declined" })]].map(matches => [matches] as const))("unknown candidates %j", matches => {
    expect(resolveFaceMatches(matches, lookups(), 80)).toEqual({ result: "unknown" });
  });
  it("groups duplicate sessions by account; close accounts resolve to the approved guest, else the closest", () => {
    const base = lookups(), rows = new Map(base.bySession); rows.set("s2", rows.get("s")!);
    expect(resolveFaceMatches([match("s", 94), match("s2", 92)], { ...base, bySession: rows }, 80).result).toBe("welcomed");
    const other = account({ id: "b", evidence: account().evidence.map(e => ({ ...e, accountId: "b" })) });
    rows.set("b-session", { ...rows.get("s")!, account: other, registration: null });
    expect(resolveFaceMatches([match("s", 94), match("b-session", 89)], { ...base, bySession: rows }, 80).result).toBe("welcomed");
    // Seen at a real door: a duplicate account without a place scores higher; the approved guest within five points wins.
    expect(resolveFaceMatches([match("b-session", 96), match("s", 92)], { ...base, bySession: rows }, 80)).toMatchObject({ result: "welcomed", accountId: account().id });
    // More than five points apart: the closest is someone else, who has no place.
    expect(resolveFaceMatches([match("b-session", 96), match("s", 90.9)], { ...base, bySession: rows }, 80).result).toBe("not_on_list");
    // Two close accounts, neither on the list: the closest one is named.
    rows.set("c-session", { ...rows.get("b-session")!, account: account({ id: "c", evidence: account().evidence.map(e => ({ ...e, accountId: "c" })) }) });
    expect(resolveFaceMatches([match("b-session", 91), match("c-session", 90)], { ...base, bySession: rows }, 80)).toMatchObject({ result: "not_on_list", accountId: "b" });
    expect(resolveFaceMatches([match("s", 94), match("b-session", 88.99)], { ...base, bySession: rows }, 80).result).toBe("welcomed");
  });
  it.each(["invalidated", "superseded", "expired", "pending", "deleting", "wrong-session"])("does not count %s face despite other account evidence", invalid => {
    const base = lookups(), lookup = base.bySession.get("s")!;
    let a = account();
    if (invalid === "deleting") a = account({ deletingAt: now });
    else a = account({ evidence: [evidence("identity"), evidence("face", invalid === "invalidated" ? { invalidatedAt: now } : invalid === "superseded" ? { supersededAt: now } : invalid === "expired" ? { validUntil: now } : invalid === "wrong-session" ? { verificationId: "other" } : { activation: "pending_continuity" })] });
    expect(resolveFaceMatches([match("s", 95)], { ...base, bySession: new Map([["s", { ...lookup, account: a }]]) }, 80).result).toBe("unknown");
  });
  it.each([[null, false, "not_on_list"], [{ ...registration, admission: "rejected" as const }, false, "not_admitted"], [registration, true, "welcome_back"], [registration, false, "welcomed"]] as const)("registration/attendance maps to %s %s %s", (r, checked, result) => {
    const base = lookups();
    expect(resolveFaceMatches([match("s", 95)], { ...base, bySession: new Map([["s", { ...base.bySession.get("s")!, registration: r, activeCheckin: checked }]]) }, 80).result).toBe(result);
  });
  it("admitted account missing another requirement is not_verified", () => {
    const base = lookups();
    expect(resolveFaceMatches([match("s", 95)], { ...base, event: { ...event, ageMin: 21 } }, 80).result).toBe("not_verified");
  });
});
const statusEvent: StatusEvent = { ...event, status: "published", startsAt: new Date(now.getTime() + day), endsAt: new Date(now.getTime() + 2 * day), registrationClosesAt: null, capacity: 100, approvedCount: 10 };
const summary: EvidenceSummary = { signedIn: true, eligible: false, verification: "not_started" };
const approved: StatusRegistration = { admission: "approved" };
const cases: Array<[DesignStatus, Partial<StatusEvent>, StatusRegistration | null, Partial<EvidenceSummary>]> = [
  ["signed_out", {}, null, { signedIn: false }], ["signed_in", {}, null, {}], ["profile_incomplete", {}, null, { profileComplete: false }], ["profile_verified", {}, null, { profileVerified: true, surface: "account" }], ["deleted", {}, null, { deleted: true }],
  ["pending", {}, { admission: "pending" }, {}], ["invited", {}, { ...approved, invited: true }, {}], ["waitlist", {}, { admission: "waitlisted" }, {}], ["rejected", {}, { admission: "rejected" }, {}], ["withdrawn", {}, { admission: "cancelled_by_guest", withdrawn: true }, {}],
  ["link_sent", {}, approved, {}], ["verifying", {}, approved, { verification: "started" }], ["in_review", {}, approved, { verification: "in_review" }], ["declined", {}, approved, { verification: "declined" }], ["verified", {}, approved, { eligible: true }], ["reused", {}, approved, { eligible: true, reused: true }], ["re_verify", {}, approved, { missing: ["face"] }],
  ["going", {}, approved, { eligible: true, surface: "attendance" }], ["cancelled", {}, { admission: "cancelled_by_guest" }, {}], ["revoked", {}, { admission: "revoked" }, {}], ["checked_in", {}, { ...approved, checkedIn: true }, {}], ["no_show", { status: "ended" }, approved, { eligible: true, surface: "attendance" }],
  ["draft", { status: "draft" }, null, {}], ["open", {}, null, { surface: "event" }], ["full", { approvedCount: 100 }, null, {}], ["closed", { registrationClosesAt: now }, null, {}], ["live", { status: "live" }, null, {}], ["ended", { status: "ended" }, null, {}],
];
describe("S-00 status model and P-02 cards", () => {
  it.skip("matches every label and all six columns in the imported S-00 source", () => {
    const source = readFileSync(new URL("../../../../design/05 Accounts and Applicants.dc.html", import.meta.url), "utf8");
    const table = source.slice(source.indexOf("const statusModel = ["), source.indexOf("// guest mobile"));
    const rows = [...table.matchAll(/ST\('([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)'\)/g)];
    expect(rows).toHaveLength(28);
    for (const [, label, setBy, guest, admin, email, canMoveTo] of rows) {
      const key = label!.toLowerCase().replaceAll(/[ -]/g, "_") as DesignStatus;
      expect(STATUS_MODEL[key]).toEqual({ label, setBy, guest, admin, email, canMoveTo });
    }
  });
  it("covers all 28 S-00 rows", () => { expect(cases.map(c => c[0]).sort()).toEqual(Object.keys(STATUS_MODEL).sort()); });
  it.each(cases)("%s", (expected, e, r, s) => {
    const result = displayStatus({ ...statusEvent, ...e }, r, { ...summary, ...s }, now);
    expect(result.status).toBe(expected);
    expect(result).toMatchObject(STATUS_MODEL[expected]);
  });
  it.each([
    ["P-02a", null, { signedIn: false }, {}], ["P-02b", { admission: "pending" }, {}, {}], ["P-02c", approved, {}, {}], ["P-02d", approved, { verification: "started" }, {}], ["P-02e", approved, { verification: "in_review" }, {}], ["P-02f", approved, { eligible: true }, {}], ["P-02g", approved, { verification: "declined" }, {}], ["P-02h", { admission: "waitlisted" }, {}, {}], ["P-02i", { admission: "rejected" }, {}, {}], ["P-02j", null, {}, { approvedCount: 100 }], ["P-02k", null, {}, { registrationClosesAt: now }], ["P-02l", { ...approved, checkedIn: true }, {}, {}], ["P-02m", approved, {}, { status: "ended" }], ["P-02n", { admission: "cancelled_by_guest" }, {}, {}],
  ] as Array<[string, StatusRegistration | null, Partial<EvidenceSummary>, Partial<StatusEvent>]>)("renders %s", (frame, r, s, e) => {
    expect(displayStatus({ ...statusEvent, ...e }, r, { ...summary, ...s }, now).frame).toBe(frame);
  });
  it("tightened requirements do not alter admission; cancellations outrank reusable evidence", () => {
    expect(displayStatus(statusEvent, approved, { ...summary, previouslyEligible: true }, now).status).toBe("requirements_unmet");
    expect(approved.admission).toBe("approved");
    expect(displayStatus(statusEvent, { admission: "revoked" }, { ...summary, eligible: true }, now).status).toBe("revoked");
  });
  it("an expired selfie still routes a previously eligible guest to U-42", () => {
    const expiredFace = { ...summary, previouslyEligible: true, missing: ["face"] };
    expect(displayStatus(statusEvent, approved, expiredFace, now).frame).toBe("U-42");
    expect(displayStatus(statusEvent, approved, { ...expiredFace, requirementsChanged: true }, now).status).toBe("requirements_unmet");
  });
});
describe("transitions and service ownership", () => {
  it.each([["pending", "approved", "staff", true], ["pending", "approved", "guest", false], ["approved", "revoked", "staff", true], ["approved", "approved", "staff", false], ["cancelled_by_guest", "pending", "guest", true], ["rejected", "approved", "system", false], ["waitlisted", "approved", "system", true]] as const)("%s -> %s by %s", (from, to, actor, expected) => { expect(canTransition(from, to, actor)).toBe(expected); });
  it("guest cannot grant admission across any state", () => { for (const from of ["pending", "approved", "waitlisted", "rejected", "cancelled_by_guest", "cancelled_by_host", "revoked"] as Admission[]) expect(canTransition(from, "approved", "guest")).toBe(false); });
  it("guest account lifecycle and integrated service ownership", async () => {
    expect(canTransitionGuest("signed_out", "signed_in", "guest")).toBe(true); expect(canTransitionGuest("deleted", "signed_in", "system")).toBe(false);
    expect(doorService).toBe(implementedDoorService);
    expect(eventService).toBeInstanceOf(Events);
    expect(admissionService).toBeInstanceOf(Admissions);
    expect(inviteService).toBeInstanceOf(Invites);
  });
});
