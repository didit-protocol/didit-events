import type { MissingCheck,MissingReason } from "../contracts/event-model.ts";
import type { EvidenceFact } from "./eligibility.ts";
import { checksSchema,documentFactSchema,phoneFactSchema,type EventChecks,type ProofCheck } from "./event-model.ts";
import { missingProfileFields,normalizedName,type ProfileFields } from "./profile.ts";

export interface AccountFacts extends ProfileFields {
  id: string; email?: string; emailVerifiedAt?: Date | null; emailProofMethod?: string | null; emailProofRef?: string | null;
  profileCompletedAt?: Date | null; onboardedAt?: Date | null; deletingAt: Date | null; deletedAt: Date | null;
  evidence: readonly EvidenceFact[];
}
export interface PolicyEvent { id: string; checks: EventChecks; policyVersion: number; formVersion: number; timezone?: string }
export type RequiredCheck = { check: "phone" | "id_document" | "name_from_id" } | { check: "age"; minimum: number };
export interface MissingResult {
  baseline: { email: boolean; profile: boolean; face: boolean; missingProfileFields: string[] };
  missing: MissingCheck[]; satisfied: Partial<Record<ProofCheck, { evidenceId: string; validUntil: Date; establishedAt:Date; source: string }>>;
  canSubmit: boolean; nextExpiryAt: Date | null;
}
export function requiredChecks(event: Pick<PolicyEvent, "checks">): readonly RequiredCheck[] {
  const checks = checksSchema.parse(event.checks);
  return [...checks.required.map(check => ({ check })), ...(checks.age_min !== undefined ? [{ check: "age" as const, minimum: checks.age_min }] : [])];
}
/** Completed calendar years; a leap-day birthday advances on March 1 in a nonleap year. */
export function ageAt(birthDate: string, now: Date, timezone = "UTC"): number | null {
  const parsed = documentFactSchema.shape.birth_date.safeParse(birthDate);
  if (!parsed.success || !parsed.data) return null;
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const field = (key: string) => Number(parts.find(p => p.type === key)?.value);
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  const age = field("year") - y - (field("month") * 100 + field("day") < m * 100 + d ? 1 : 0);
  return age >= 0 ? age : null;
}
const ttl = (e: EvidenceFact) => (e.kind === "face" ? 180 : 365) * 86400_000;
function expiry(e: EvidenceFact, maxAge?: number): Date {
  let until = Math.min(e.validUntil.getTime(), e.establishedAt.getTime() + ttl(e));
  if (maxAge !== undefined) until = Math.min(until, e.establishedAt.getTime() + maxAge * 1000 + 1);
  if (e.kind === "document") {
    const doc = documentFactSchema.safeParse(e.value);
    if (doc.success && doc.data.expires_on) until = Math.min(until, Date.parse(`${doc.data.expires_on}T00:00:00Z`) + 86400_000);
  }
  return new Date(until);
}
function failure(e: EvidenceFact, now: Date, maxAge?: number): MissingReason | null {
  if (e.activation === "revoked" || e.invalidatedAt || e.providerStatus === "withdrawn" || e.providerStatus === "declined") return "revoked";
  if (e.activation === "pending_continuity") return "continuity_required";
  if (e.providerStatus !== "approved" || e.establishedAt > now) return "in_review";
  if (e.supersededAt || e.activation !== "active") return "absent";
  if (!Number.isFinite(expiry(e, maxAge).getTime()) || expiry(e, maxAge) <= now) return "expired";
  return null;
}
export function missingChecks(account: AccountFacts, event: PolicyEvent, now: Date): MissingResult {
  const checks = checksSchema.parse(event.checks), fields = missingProfileFields(account);
  const result: MissingResult = { baseline: { email: !!account.emailVerifiedAt && account.emailVerifiedAt <= now && !!account.emailProofRef &&
    ["didit_otp", "didit_google", "legacy_verified"].includes(account.emailProofMethod ?? ""), profile: !fields.length, face: false, missingProfileFields: fields },
    missing: [], satisfied: {}, canSubmit: false, nextExpiryAt: null };
  const rows = account.evidence.filter(e => e.accountId === account.id);
  const faces = rows.filter(e => e.kind === "face" && e.activation === "active" && !e.supersededAt);
  const face = faces.length === 1 ? faces[0] : undefined;
  const selected = (check: ProofCheck, proof: EvidenceFact, max?: number) => {
    const until = expiry(proof, max); result.satisfied[check] = { evidenceId: proof.id, validUntil: until, establishedAt:proof.establishedAt, source: proof.source ?? "legacy" };
    if (!result.nextExpiryAt || until < result.nextExpiryAt) result.nextExpiryAt = until;
  };
  if (face && !failure(face, now)) { result.baseline.face = true; selected("face", face); }
  else {
    const latest = face ?? rows.filter(e => e.kind === "face").sort((a,b) => b.establishedAt.getTime()-a.establishedAt.getTime())[0];
    result.missing.push({ check: "face", reason: latest ? failure(latest, now) ?? "in_review" : "absent" });
  }
  // Revoked ancestry and recovered chain breaks do not convey subject binding.
  const faceIds = new Set<string>(), verificationIds = new Set<string>();
  let ancestor = face;
  while (ancestor && !faceIds.has(ancestor.id) && ancestor.providerStatus === "approved" && !ancestor.invalidatedAt && ancestor.activation !== "revoked") {
    faceIds.add(ancestor.id); verificationIds.add(ancestor.verificationId);
    ancestor = ancestor.continuityOf ? rows.find(e => e.kind === "face" && e.verificationId === ancestor!.continuityOf && e.activation === "superseded") : undefined;
  }
  for (const required of requiredChecks(event)) {
    const check = required.check;
    const candidates = rows.filter(e => check === "phone" ? e.kind === "phone" : check === "age" ? e.kind === "age" || e.kind === "document" : e.kind === "document");
    let reason: MissingReason = "absent";
    const qualified: { proof: EvidenceFact; max?: number }[] = [];
    for (const proof of candidates.sort((a,b) => b.establishedAt.getTime()-a.establishedAt.getTime() || a.id.localeCompare(b.id))) {
      const max = check === "phone" ? checks.max_age.phone : check === "age" ? Math.min(checks.max_age.age??Infinity,proof.kind==="document"?checks.max_age.document??Infinity:Infinity) : check === "name_from_id" ? Math.min(checks.max_age.document ?? Infinity, checks.max_age.name_from_id ?? Infinity) : checks.max_age.document;
      const bad = failure(proof, now, Number.isFinite(max) ? max : undefined);
      if (bad) { if (reason === "absent") reason = bad; continue; }
      if (check === "phone") {
        if (proof.binding !== "account" || !phoneFactSchema.safeParse(proof.value).success) { reason = "in_review"; continue; }
      } else if (proof.binding === "face_chain" ? !proof.subjectFaceId || !faceIds.has(proof.subjectFaceId) :
        proof.kind !== "age" || !verificationIds.has(proof.verificationId)) { reason = "continuity_required"; continue; }
      if (proof.kind === "document") {
        const doc = documentFactSchema.safeParse(proof.value);
        if (!doc.success) { reason = "in_review"; continue; }
        if (checks.max_age.document !== undefined && failure(proof, now, checks.max_age.document)) { reason = "expired"; continue; }
        if (check === "name_from_id" && normalizedName(doc.data.legal_name) !== normalizedName(account.fullName ?? "")) { reason = "name_mismatch"; continue; }
        if (check === "age") {
          const age = doc.data.birth_date ? ageAt(doc.data.birth_date, now, event.timezone) : null;
          if (age === null || age < checks.age_min!) { reason = age === null ? "absent" : "below_minimum"; continue; }
        }
      } else if (check === "age" && (typeof proof.value !== "number" || !Number.isFinite(proof.value) || proof.value < checks.age_min!)) { reason = "below_minimum"; continue; }
      qualified.push({ proof, max: Number.isFinite(max) ? max : undefined });
    }
    qualified.sort((a,b) => expiry(b.proof,b.max).getTime()-expiry(a.proof,a.max).getTime() || b.proof.establishedAt.getTime()-a.proof.establishedAt.getTime() || a.proof.id.localeCompare(b.proof.id));
    const best = qualified[0];
    if (best) selected(check, best.proof, best.max);
    else result.missing.push({ check, reason, ...(check === "age" ? { minimum: checks.age_min } : {}) });
  }
  result.canSubmit = !account.deletingAt && !account.deletedAt && result.baseline.email && result.baseline.profile && result.baseline.face && !result.missing.length;
  return result;
}
