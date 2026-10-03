import { describe, expect, it } from "vitest";
import { deriveEvidence, type EvidenceChanges, type EvidenceDecision, type EvidenceHistory } from "./evidence.ts";
import { eligible, type EvidenceFact } from "./eligibility.ts";
import { resolveFaceMatches, type DoorEvent } from "./door.ts";

const now = new Date("2026-09-29T10:00:00Z"), day = 86400_000;
const decision = (patch: Partial<EvidenceDecision> = {}): EvidenceDecision => ({ accountId: "account", verificationId: "new", providerStatus: "approved", establishedAt: now, observedAt: now, proofs: [{ kind: "face", value: null }], matches: [], ...patch });
const empty: EvidenceHistory = { evidence: [], hasFaceHistory: false, sessionIds: new Map() };
const initial = (): EvidenceFact => ({ ...deriveEvidence(decision({ verificationId: "old" }), empty).insert[0]!, id: "old-face" });
const history = (rows: EvidenceFact[] = [initial()]): EvidenceHistory => ({ evidence: rows, hasFaceHistory: true, sessionIds: new Map([["old", "old-session"], ["new", "new-session"]]) });
const match = (score: number, session = "old-session") => ({ session_id: session, similarity_percentage: score, is_blocklisted: false, api_service: null, status: "Approved" });
const fullProofs = (age: number): EvidenceDecision["proofs"] => [{ kind: "identity", value: {} }, { kind: "face", value: null }, { kind: "age", value: age }];
const apply = (rows: EvidenceFact[], changes: EvidenceChanges): EvidenceFact[] => [
  ...rows.map(row => changes.update.find(update => update.id === row.id) ?? row),
  ...changes.insert.map(row => ({ ...row, id: `${row.verificationId}-${row.kind}` })),
];
const ageEvent = { endsAt: new Date(+now + day), requirements: { identity: false, email: false, liveness: true }, maxAge: {}, ageMin: 18 };
const account = (evidence: EvidenceFact[]) => ({ id: "account", deletingAt: null, deletedAt: null, evidence });

describe("C21/C24/C25 evidence derivation", () => {
  it("initial approval activates all approved proofs; repeated decisions are no-ops with unchanged validity", () => {
    const d = decision({ proofs: [{ kind: "identity", value: {} }, { kind: "face", value: null }, { kind: "age", value: 18 }] });
    const first = deriveEvidence(d, empty);
    expect(first.insert.map(e => e.activation)).toEqual(["active", "active", "active"]);
    const rows = first.insert.map((e, i) => ({ ...e, id: String(i) }));
    expect(rows.find(e => e.kind === "face")!.validUntil.getTime() - now.getTime()).toBe(180 * day);
    expect(deriveEvidence({ ...d, observedAt: new Date(+now + day), establishedAt: new Date(+now + day) }, history(rows))).toEqual({ insert: [], update: [], recoveryAudit: null });
  });
  it.each([
    ["renewal pending", [], "pending_continuity"], ["below continuity", [match(89.99)], "pending_continuity"],
    ["exact threshold", [match(90)], "active"], ["above threshold", [match(99)], "active"],
    ["wrong session", [match(99, "foreign")], "pending_continuity"],
    ["blocked match", [{ ...match(99), is_blocklisted: true }], "pending_continuity"],
    ["api match", [{ ...match(99), api_service: "FACE_SEARCH" }], "pending_continuity"],
  ] as const)("%s", (_, matches, activation) => {
    const old = initial(), result = deriveEvidence(decision({ matches }), history([old]));
    expect(result.insert[0]!.activation).toBe(activation);
    expect(result.update).toHaveLength(activation === "active" ? 1 : 0);
    if (activation === "active") expect(result.update[0]).toMatchObject({ id: old.id, activation: "superseded", supersededAt: now });
    expect(old.activation).toBe("active");
  });
  it.each(["full", "age", "renewal"])("every %s workflow replacement uses the same continuity rule", workflow => {
    const proofs = workflow === "age" ? [{ kind: "face" as const, value: null }, { kind: "age" as const, value: 18 }] : [{ kind: "face" as const, value: null }];
    expect(deriveEvidence(decision({ proofs }), history()).insert.every(e => e.activation === "pending_continuity")).toBe(true);
  });
  it("old face + age 16 cannot borrow age 25 from an unlinked replacement age workflow", () => {
    const old = apply([], deriveEvidence(decision({ verificationId: "old", proofs: fullProofs(16) }), empty));
    const pending = deriveEvidence(decision({ proofs: [{ kind: "age", value: 25 }, { kind: "face", value: null }] }), history(old));
    expect(pending.insert.map(row => row.activation)).toEqual(["pending_continuity", "pending_continuity"]);
    expect(pending.update).toEqual([]);
    expect(eligible(account(apply(old, pending)), ageEvent)).toBe(false);
    // Defense in depth for legacy data written before the unit activation gate.
    const legacy = apply(old, pending).map(row => row.verificationId === "new" && row.kind === "age" ? { ...row, activation: "active" as const, state: "active" as const } : row);
    expect(eligible(account(legacy), ageEvent)).toBe(false);
  });
  it.each(["continuity", "recovery"] as const)("%s activates every pending proof and supersedes every replaced kind, without extending validity", mode => {
    const old = apply([], deriveEvidence(decision({ verificationId: "old", proofs: fullProofs(16) }), empty));
    const d = decision({ proofs: fullProofs(25) });
    const pending = apply(old, deriveEvidence(d, history(old)));
    const approved = { ...d, observedAt: new Date(+now + day), establishedAt: new Date(+now + day),
      ...(mode === "continuity" ? { matches: [match(90)] } : { recovery: { role: "owner" as const, staff: "owner@example.test", authenticatedAt: new Date(+now + day), reason: "Confirmed in person" } }) };
    const changes = deriveEvidence(approved, history(pending));
    expect(changes.insert).toEqual([]);
    expect(changes.update.filter(row => row.verificationId === "old").map(row => row.activation)).toEqual(["superseded", "superseded", "superseded"]);
    expect(changes.update.filter(row => row.verificationId === "new")).toEqual(expect.arrayContaining(fullProofs(25).map(proof => expect.objectContaining({
      kind: proof.kind, activation: "active", establishedAt: now, continuityOf: mode === "continuity" ? "old" : null,
      recoveredBy: mode === "recovery" ? "owner@example.test" : null,
    }))));
    const rows = apply(pending, changes);
    expect(eligible(account(rows), ageEvent)).toBe(true);
    expect(deriveEvidence(approved, history(rows))).toEqual({ insert: [], update: [], recoveryAudit: null });
  });
  it.each(["continuity", "recovery"] as const)("new %s approval activates all proofs in one unit", mode => {
    const old = apply([], deriveEvidence(decision({ verificationId: "old", proofs: fullProofs(16) }), empty));
    const changes = deriveEvidence(decision({ proofs: fullProofs(25), ...(mode === "continuity" ? { matches: [match(90)] } : {
      recovery: { role: "admin" as const, staff: "admin@example.test", authenticatedAt: now, reason: "In-person recovery" },
    }) }), history(old));
    expect(changes.insert).toHaveLength(3);
    expect(changes.insert.every(row => row.activation === "active" && row.continuityOf === (mode === "continuity" ? "old" : null))).toBe(true);
    expect(changes.update.map(row => row.activation)).toEqual(["superseded", "superseded", "superseded"]);
  });
  it("late proofs inherit their verification's pending or superseded activation", () => {
    const pending = apply([initial()], deriveEvidence(decision(), history()));
    expect(deriveEvidence(decision({ proofs: fullProofs(25) }), history(pending)).insert.map(row => row.activation)).toEqual(["pending_continuity", "pending_continuity"]);
    const replaced = apply([initial()], deriveEvidence(decision({ matches: [match(90)] }), history()));
    expect(deriveEvidence(decision({ verificationId: "old", proofs: fullProofs(25) }), history(replaced)).insert.map(row => row.activation)).toEqual(["superseded", "superseded"]);
  });
  it("proofs arriving before a face stay pending until that face can activate", () => {
    const pending = apply([], deriveEvidence(decision({ proofs: [{ kind: "age", value: 25 }] }), empty));
    expect(pending[0]!.activation).toBe("pending_continuity");
    const changes = deriveEvidence(decision(), { ...empty, evidence: pending });
    expect(changes.update[0]).toMatchObject({ kind: "age", activation: "active" });
    expect(changes.insert[0]).toMatchObject({ kind: "face", activation: "active" });
  });
  it("an expired retained face still anchors continuity without granting current eligibility", () => {
    const old = initial(); old.validUntil = now;
    expect(deriveEvidence(decision({ matches: [match(99)] }), history([old])).insert[0]!.activation).toBe("active");
  });
  it.each(["purged", "withdrawn", "revoked"])("no usable previous reference (%s) requires recovery", state => {
    const old = initial();
    if (state === "withdrawn") { old.providerStatus = "withdrawn"; old.invalidatedAt = now; }
    if (state === "revoked") old.activation = "revoked";
    const h = history(state === "purged" ? [] : [old]);
    expect(deriveEvidence(decision({ matches: [match(99)] }), h).insert[0]!.activation).toBe("pending_continuity");
    const result = deriveEvidence(decision({ recovery: { role: "admin", staff: "admin@example.test", authenticatedAt: now, reason: "In-person recovery" } }), h);
    expect(result.insert[0]).toMatchObject({ activation: "active", recoveredBy: "admin@example.test", recoveryReason: "In-person recovery" });
    expect(result.recoveryAudit).toMatchObject({ actor: "admin@example.test", reason: "In-person recovery" });
  });
  it.each([
    { role: "staff" as const }, { reason: " " }, { staff: "" },
    { authenticatedAt: new Date(+now - 15 * 60_000) }, { authenticatedAt: new Date(+now + 1) },
  ])("rejects unauthorized or stale recovery %j", patch => {
    expect(() => deriveEvidence(decision({ recovery: { role: "owner", staff: "owner@example.test", reason: "Recovery", authenticatedAt: now, ...patch } }), history())).toThrow("InvalidEvidenceRecovery");
  });
  it("explicit recovery can activate an existing pending session with an audit; a repeated recovery is a no-op", () => {
    const pending = { ...deriveEvidence(decision(), history()).insert[0]!, id: "pending-face" };
    const d = decision({ recovery: { role: "owner", staff: "owner@example.test", authenticatedAt: now, reason: "Confirmed in person" } });
    const changes = deriveEvidence(d, history([initial(), pending]));
    expect(changes.insert).toEqual([]);
    expect(changes.update.map(row => row.activation)).toEqual(["superseded", "active"]);
    expect(changes.recoveryAudit).toMatchObject({ actor: "owner@example.test", reason: "Confirmed in person" });
    expect(deriveEvidence(d, history(changes.update))).toEqual({ insert: [], update: [], recoveryAudit: null });
  });
  it("old-session withdrawal and re-approval never reactivate a face after a newer face activates", () => {
    const replacement = deriveEvidence(decision({ matches: [match(90)] }), history());
    const newer = { ...replacement.insert[0]!, id: "new-face" }, old = replacement.update[0]!;
    const withdrawn = deriveEvidence(decision({ verificationId: "old", providerStatus: "withdrawn" }), history([old, newer])).update[0]!;
    expect(withdrawn).toMatchObject({ providerStatus: "withdrawn", activation: "superseded", invalidatedReason: "provider_withdrawn" });
    const restored = deriveEvidence(decision({ verificationId: "old", observedAt: new Date(+now + day), establishedAt: new Date(+now + day) }), history([withdrawn, newer])).update[0]!;
    expect(restored).toMatchObject({ providerStatus: "approved", activation: "superseded", invalidatedAt: null, establishedAt: old.establishedAt, validUntil: old.validUntil });
    expect(restored.supersededAt).toEqual(now);
  });
  it("withdrawal/re-approval preserves the current activation and original verification time", () => {
    const old = initial();
    const withdrawn = deriveEvidence(decision({ verificationId: "old", providerStatus: "withdrawn" }), history()).update[0]!;
    expect(withdrawn.activation).toBe("active");
    const restored = deriveEvidence(decision({ verificationId: "old" }), history([withdrawn])).update[0]!;
    expect(restored).toEqual(old);
  });
  it("re-approval preserves a local revocation's invalidation time and reason", () => {
    const revoked: EvidenceFact = { ...initial(), providerStatus: "withdrawn", activation: "revoked", state: "invalidated", invalidatedAt: now, invalidatedReason: "account_deleted" };
    expect(deriveEvidence(decision({ verificationId: "old" }), history([revoked])).update).toEqual([{ ...revoked, providerStatus: "approved" }]);
  });
  it.each(["pending_continuity", "revoked"] as const)("re-approval cannot activate %s", activation => {
    const row = { ...initial(), activation, providerStatus: "withdrawn" as const };
    expect(deriveEvidence(decision({ verificationId: "old" }), history([row])).update[0]!.activation).toBe(activation);
  });
  it("nonapproved decisions create no evidence and missing approval time fails closed", () => {
    expect(deriveEvidence(decision({ providerStatus: "in_review" }), empty).insert).toEqual([]);
    expect(() => deriveEvidence(decision({ establishedAt: null }), empty)).toThrow("MissingAuthoritativeEstablishedAt");
  });
});

describe("C25 eligibility and exact face resolution", () => {
  const event: DoorEvent = { id: "event", startsAt: now, endsAt: new Date(+now + day), status: "live", requirements: { identity: false, email: false, liveness: true }, maxAge: {}, doorMode: "supervised" };
  it.each([
    ["active", "approved", true], ["active", "withdrawn", false], ["active", "in_review", false], ["active", "declined", false],
    ["pending_continuity", "approved", false], ["superseded", "approved", false], ["revoked", "approved", false],
  ] as const)("%s / %s is usable: %s", (activation, providerStatus, expected) => {
    const face = { ...initial(), activation, providerStatus }, account = { id: "account", deletingAt: null, deletedAt: null, evidence: [face] };
    expect(eligible(account, event)).toBe(expected);
    const result = resolveFaceMatches([match(99)], { event, now, bySession: new Map([["old-session", { account, verificationId: "old", faceEvidenceId: face.id, registration: null, activeCheckin: false }]]) }, 80);
    expect(result.result).toBe(expected ? "not_on_list" : "unknown");
  });
  it("uses older identity/age only along the current face's continuity chain, including multiple renewals", () => {
    const original = apply([], deriveEvidence(decision({ verificationId: "old", proofs: fullProofs(25) }), empty));
    const renewed = apply(original, deriveEvidence(decision({ matches: [match(90)] }), history(original)));
    const twice = apply(renewed, deriveEvidence(decision({ verificationId: "third", matches: [match(95, "new-session")] }), history(renewed)));
    const requiresAll = { ...ageEvent, requirements: { identity: true, email: true, liveness: true } };
    expect(eligible(account(twice), requiresAll)).toBe(true);
    expect(eligible(account(twice.filter(row => row.verificationId !== "new")), requiresAll)).toBe(false);
    const unrelated = twice.map(row => row.kind !== "face" ? { ...row, verificationId: "unrelated" } : row);
    expect(eligible(account(unrelated), requiresAll)).toBe(false);
    const foreignLink = twice.map(row => row.verificationId === "new" ? { ...row, accountId: "foreign" } : row);
    expect(eligible(account(foreignLink), requiresAll)).toBe(false);
    const withdrawnAge = twice.map(row => row.kind === "age" ? { ...row, providerStatus: "withdrawn" as const } : row);
    expect(eligible(account(withdrawnAge), requiresAll)).toBe(false);
  });
  it("recovery resets the chain and cannot reuse old identity or age absent from the recovered verification", () => {
    const original = apply([], deriveEvidence(decision({ verificationId: "old", proofs: fullProofs(25) }), empty));
    const recovered = apply(original, deriveEvidence(decision({ recovery: { role: "owner", staff: "owner@example.test", authenticatedAt: now, reason: "Recovery" } }), history(original)));
    expect(eligible(account(recovered), ageEvent)).toBe(false);
    expect(eligible(account(recovered), { ...event, requirements: { identity: true, email: true, liveness: true } })).toBe(false);
    expect(eligible(account(recovered), event)).toBe(true);
  });
});
