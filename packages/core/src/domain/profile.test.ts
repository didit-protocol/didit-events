import { describe,expect,it } from "vitest";
import type { EvidenceFact } from "./eligibility.ts";
import { ageAt,missingChecks,type AccountFacts } from "./missing-checks.ts";
import { normalizedName } from "./profile.ts";

const now = new Date("2026-03-01T00:00:00Z");
const proof = (id: string, kind: EvidenceFact["kind"], patch: Partial<EvidenceFact> = {}): EvidenceFact => ({
  id, kind, accountId: "account", verificationId: id, value: null, establishedAt: new Date(now.getTime() - 1000),
  validUntil: new Date(now.getTime() + 86400_000), providerStatus: "approved", activation: "active",
  state:"active", invalidatedReason:null, recoveredBy:null,recoveryReason:null, continuityOf: null, invalidatedAt: null, supersededAt: null, ...patch,
});
const account = (evidence: EvidenceFact[]): AccountFacts => ({ id: "account", email: "a@example.test",
  emailVerifiedAt: new Date(now.getTime() - 1000), emailProofMethod: "didit_otp", emailProofRef: "test",
  fullName: "Alex", headline: "Engineer", company: "Independent", jobRole: "", bio: "Building things.",
  profileLinks: [{ kind: "website", label: "Website", href: "https://example.test/" }],
  deletingAt: null, deletedAt: null, evidence });
const policy = { id: "event", policyVersion: 1, formVersion: 1, timezone: "UTC", checks: { version: 1 as const, required: [], max_age: {} } };

describe("baseline and derived extra checks", () => {
  it("requires baseline even for empty extras; phone is independently account-bound", () => {
    expect(missingChecks(account([]), policy, now).canSubmit).toBe(false);
    const facts = account([proof("face", "face"), proof("phone", "phone", { value: { e164: "+34600000000" }, binding: "account" })]);
    const event = { ...policy, checks: { ...policy.checks, required: ["phone" as const] } };
    expect(missingChecks(facts, event, now).canSubmit).toBe(true);
    expect(missingChecks({ ...facts, evidence: facts.evidence.slice(1) }, event, now).satisfied.phone).toBeDefined();
    expect(missingChecks({ ...facts, emailVerifiedAt: null }, event, now).canSubmit).toBe(false);
    expect(missingChecks({ ...facts, deletingAt: now }, event, now).canSubmit).toBe(false);
  });
  it("checks exact freshness boundaries, decimal age and leap-day birthdays", () => {
    const face = proof("face", "face");
    expect(missingChecks(account([{ ...face, validUntil: now }]), policy, now).baseline.face).toBe(false);
    const age = proof("age", "age", { binding: "face_chain", subjectFaceId: "face", source: "age_estimation", value: 17.99 });
    const event = { ...policy, checks: { ...policy.checks, age_min: 18, max_age: { age: 1 } } };
    expect(missingChecks(account([face, age]), event, now).missing).toContainEqual({ check: "age", reason: "below_minimum", minimum: 18 });
    expect(missingChecks(account([face, { ...age, value: 18 }]), event, now).canSubmit).toBe(true);
    expect(missingChecks(account([face, { ...age, value: 18 }]), event, new Date(now.getTime() + 1)).canSubmit).toBe(false);
    expect(ageAt("2008-02-29", new Date("2026-02-28T23:59:59Z"))).toBe(17);
    expect(ageAt("2008-02-29", now)).toBe(18);
  });
  it("shares the document proof across name/age and invalidates both on withdrawal or a chain reset", () => {
    const face = proof("face", "face");
    const document = proof("doc", "document", { binding: "face_chain", subjectFaceId: "face", source: "document", value: { legal_name: "Alex", birth_date: "2000-01-01", expires_on: null } });
    const event = { ...policy, checks: { ...policy.checks, required: ["id_document", "name_from_id"] as ("id_document" | "name_from_id")[], age_min: 18 } };
    const ready = missingChecks(account([face, document]), event, now);
    expect(ready.canSubmit).toBe(true);
    expect(ready.satisfied.age?.evidenceId).toBe(ready.satisfied.name_from_id?.evidenceId);
    const withdrawn = missingChecks(account([face, { ...document, invalidatedAt: now }]), event, now);
    expect(withdrawn.missing.map(m => m.check)).toEqual(["id_document", "name_from_id", "age"]);
    const renamed = missingChecks({ ...account([face, document]), fullName: "Someone else" }, event, now);
    expect(renamed.missing).toEqual([{ check: "name_from_id", reason: "name_mismatch" }]);
    expect(renamed.baseline.face).toBe(true);
    expect(missingChecks(account([{ ...face, activation: "superseded", supersededAt: now }, proof("recovered", "face"), document]), event, now).canSubmit).toBe(false);
    expect(normalizedName("  ALEX   Smith ")).toBe(normalizedName("Alex Smith"));
  });
});
