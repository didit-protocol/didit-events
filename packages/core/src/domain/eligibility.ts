import { missingChecks,type AccountFacts,type PolicyEvent } from "./missing-checks.ts";
import { DEFAULT_TTL_DAYS,maxAgeSchema,requirementsSchema,type EvidenceKind,type MaxAge,type Requirements } from "./requirements.ts";
export interface EvidenceFact {
  source?: "legacy" | "liveness" | "phone" | "document" | "age_estimation";
  binding?: "legacy_chain" | "account" | "face_chain"; subjectFaceId?: string | null;
  id: string; accountId: string; verificationId: string; kind: EvidenceKind; value: number | Record<string, unknown> | null;
  establishedAt: Date; validUntil: Date; invalidatedAt: Date | null; supersededAt: Date | null;
  providerStatus: "approved" | "withdrawn" | "in_review" | "declined";
  activation: "pending_continuity" | "active" | "superseded" | "revoked";
  /** Previous verification matched at activation; null starts a chain (initial approval or recovery). */
  continuityOf: string | null;
  invalidatedReason: string | null; recoveredBy: string | null; recoveryReason: string | null;
  /** Legacy mirror retained during the expand-only migration. */
  state: "active" | "pending_continuity" | "superseded" | "invalidated";
}
export interface EvidenceAccount extends Partial<Omit<AccountFacts, "id" | "evidence" | "deletingAt" | "deletedAt">> { id: string; deletingAt: Date | null; deletedAt: Date | null; evidence: readonly EvidenceFact[] }
export interface EligibilityEvent extends Partial<PolicyEvent> { endsAt: Date; requirements: Requirements; maxAge: MaxAge; ageMin?: number | null }
export interface EligibilityResult { eligible: boolean; missing: EvidenceKind[]; evidenceIds: Partial<Record<EvidenceKind, string>> }
export function requiredKinds(event: EligibilityEvent): EvidenceKind[] {
  const requirements = requirementsSchema.parse(event.requirements);
  return [...(requirements.identity || requirements.email ? ["identity" as const] : []), ...(requirements.liveness ? ["face" as const] : []), ...(event.ageMin != null || requirements.age_min !== undefined ? ["age" as const] : [])];
}
/** V2 evaluates at the action time. The no-checks branch is an explicit pre-v2 fixture decoder. */
export function evidenceMeets(e: EvidenceFact, event: EligibilityEvent, now = new Date()): boolean {
  if (event.checks) return !e.invalidatedAt && !e.supersededAt && e.activation === "active" && e.providerStatus === "approved" &&
    e.establishedAt <= now && e.validUntil > now && e.establishedAt.getTime() + DEFAULT_TTL_DAYS[e.kind] * 86400_000 > now.getTime();

  if (e.invalidatedAt || e.supersededAt || e.activation !== "active" || e.providerStatus !== "approved") return false;
  const established = e.establishedAt.getTime(), end = event.endsAt.getTime();
  if (!Number.isFinite(established) || !Number.isFinite(end) || !(e.validUntil.getTime() > end) || !(established + DEFAULT_TTL_DAYS[e.kind] * 86400_000 > end)) return false;
  // A verification after the event end cannot establish eligibility for that event.
  if (established > end) return false;
  const maxAge = maxAgeSchema.parse(event.maxAge)[e.kind as keyof MaxAge];
  if (maxAge !== undefined && established < end - maxAge * 1000) return false;
  const min = event.ageMin ?? event.requirements.age_min;
  if (e.kind === "age" && min !== undefined && min !== null && (typeof e.value !== "number" || !Number.isFinite(e.value) || e.value < min)) return false;
  return true;
}
export function eligibility(account: EvidenceAccount, event: EligibilityEvent, now = new Date()): EligibilityResult {
  if (event.checks) {
    const result = missingChecks(account as AccountFacts, event as PolicyEvent, now);
    const kinds: Record<string, EvidenceKind> = { face: "face", phone: "phone", id_document: "document", name_from_id: "document", age: "age" };
    return { eligible: result.canSubmit, missing: [...new Set([...result.missing.map(m => kinds[m.check]!), ...(!result.baseline.email || !result.baseline.profile ? ["identity" as const] : [])])],
      evidenceIds: Object.fromEntries(Object.entries(result.satisfied).map(([k,v]) => [kinds[k],v!.evidenceId])) };
  }
  // Explicit compatibility evaluator for pre-v2 fixtures only. Persisted events always have checks.

  const kinds = requiredKinds(event), evidenceIds: Partial<Record<EvidenceKind, string>> = {};
  if (account.deletingAt || account.deletedAt) return { eligible: false, missing: kinds, evidenceIds };
  const rows = account.evidence.filter(e => e.accountId === account.id);
  const faces = rows.filter(e => e.kind === "face" && e.activation === "active");
  const current = faces.length === 1 && evidenceMeets(faces[0]!, event) ? faces[0] : undefined;
  // Only the current face and its recorded ancestors bind non-face proofs to this person.
  // Historical faces establish links, not eligibility: their own TTL may have expired.
  const chain = new Map<string, EvidenceFact>();
  let face = current;
  while (face && !chain.has(face.verificationId)) {
    chain.set(face.verificationId, face);
    const previous = face.continuityOf;
    face = previous ? rows.find(e => e.kind === "face" && e.verificationId === previous && e.activation === "superseded") : undefined;
  }
  for (const kind of kinds) {
    const proof = rows.find(e => e.kind === kind && chain.has(e.verificationId) &&
      e.continuityOf === chain.get(e.verificationId)!.continuityOf && evidenceMeets(e, event));
    if (proof) evidenceIds[kind] = proof.id;
  }
  const missing = kinds.filter(kind => !evidenceIds[kind]);
  return { eligible: missing.length === 0, missing, evidenceIds };
}
export function eligible(account: EvidenceAccount, event: EligibilityEvent): boolean { return eligibility(account, event).eligible; }
