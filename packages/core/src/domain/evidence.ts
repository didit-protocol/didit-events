import type { FaceMatch } from "../didit/types.ts";
import type { EvidenceFact } from "./eligibility.ts";
import { DEFAULT_TTL_DAYS,type EvidenceKind } from "./requirements.ts";

export interface EvidenceRecovery {
  staff: string; role: "owner" | "admin" | "staff"; authenticatedAt: Date; reason: string;
}
/** B1 binds these authoritative facts to a local account/verification. Never use fetch time as establishedAt.
 * Proofs come from approved workflow steps; raw provider parsing and identity/email binding belong to B1.
 */
export interface EvidenceDecision {
  accountId: string; verificationId: string; providerStatus: EvidenceFact["providerStatus"];
  establishedAt: Date | null; observedAt: Date;
  proofs: readonly { kind: EvidenceKind; value: EvidenceFact["value"] }[];
  matches: readonly FaceMatch[];
  recovery?: EvidenceRecovery;
}
export interface EvidenceHistory {
  evidence: readonly EvidenceFact[];
  /** Must survive evidence purging (derive from retained verification/account history). */
  hasFaceHistory: boolean;
  /** Local verification id -> provider session id. */
  sessionIds: ReadonlyMap<string, string>;
}
export type EvidenceInsert = Omit<EvidenceFact, "id">;
export interface EvidenceChanges {
  insert: EvidenceInsert[]; update: EvidenceFact[];
  /** B1 MUST insert this audit in the same account-locked transaction as a recovered activation. */
  recoveryAudit: { actor: string; action: "evidence_recovered"; target: string; reason: string } | null;
}
function recoveryApproval(recovery: EvidenceRecovery, now: Date): { staff: string; reason: string } {
  const age = now.getTime() - recovery.authenticatedAt.getTime();
  if (!(recovery.role === "owner" || recovery.role === "admin") || !recovery.staff.trim() || !recovery.reason.trim() || !Number.isFinite(age) || age < 0 || age >= 15 * 60_000) throw new Error("InvalidEvidenceRecovery");
  return { staff: recovery.staff, reason: recovery.reason.trim() };
}
const validDate = (date: Date): boolean => Number.isFinite(date.getTime());
/** C21/C24/C25. Pure changeset; apply under lockForDecision, superseding updates BEFORE active inserts.
 * Read the entire account's evidence/history under that lock. Re-fetches never extend validity or reactivate rows.
 */
export function deriveEvidence(decision: EvidenceDecision, existing: EvidenceHistory): EvidenceChanges {
  const { observedAt: now, accountId, verificationId, providerStatus } = decision;
  if (!validDate(now) || existing.evidence.some(row => row.accountId !== accountId)) throw new Error("InvalidEvidenceContext");
  const changes: EvidenceChanges = { insert: [], update: [], recoveryAudit: null };
  const rows = existing.evidence;
  const active = rows.filter(row => row.kind === "face" && row.activation === "active");
  if (active.length > 1) throw new Error("MultipleActiveFaces");
  for (const row of rows.filter(row => row.verificationId === verificationId)) {
    if (row.providerStatus === providerStatus) continue;
    // A local revocation and its reason cannot be cleared by any provider decision.
    if (row.activation === "revoked") { changes.update.push({ ...row, providerStatus }); continue; }
    // Provider state cannot change local activation, including superseded/pending rows.
    const invalidatedAt = providerStatus === "approved" ? null : row.invalidatedAt ?? now;
    const invalidatedReason = providerStatus === "approved" ? null : `provider_${providerStatus}`;
    const state = row.activation === "active" && invalidatedAt ? "invalidated" : row.activation;
    changes.update.push({ ...row, providerStatus, invalidatedAt, invalidatedReason, state });
  }
  if (providerStatus !== "approved") return changes;
  if (new Set(decision.proofs.map(p => p.kind)).size !== decision.proofs.length) throw new Error("DuplicateEvidenceKind");
  const own = rows.filter(row => row.verificationId === verificationId);
  const ownFace = own.find(row => row.kind === "face");
  const missing = decision.proofs.filter(proof => !own.some(row => row.kind === proof.kind));
  const hasFace = !!ownFace || missing.some(proof => proof.kind === "face");
  let activation: EvidenceFact["activation"] = ownFace?.activation ?? "pending_continuity";
  let continuityOf = ownFace?.continuityOf ?? null;
  let recoveredBy = ownFace?.recoveredBy ?? null, recoveryReason = ownFace?.recoveryReason ?? null;
  // Decide once for the whole verification, including proofs arriving before its face.
  // Superseded/revoked sessions cannot be resurrected by re-approval or late proof arrival.
  if (hasFace && (!ownFace || ownFace.activation === "pending_continuity")) {
    const previous = active[0];
    const replacement = existing.hasFaceHistory || rows.some(row => row.kind === "face");
    const usable = previous && previous.providerStatus === "approved" && !previous.invalidatedAt && !previous.supersededAt && previous.establishedAt <= now;
    const sessionId = previous && existing.sessionIds.get(previous.verificationId);
    const continuity = usable && sessionId && decision.matches.some(match => match.session_id === sessionId && Number.isFinite(match.similarity_percentage) && match.similarity_percentage >= 90 && match.similarity_percentage <= 100 && !match.is_blocklisted && !match.api_service && (match.status == null || match.status === "Approved"));
    if (!replacement || continuity) {
      activation = "active";
      continuityOf = continuity ? previous!.verificationId : null;
    } else if (decision.recovery) {
      const recovery = recoveryApproval(decision.recovery, now);
      activation = "active"; recoveredBy = recovery.staff; recoveryReason = recovery.reason;
      // Recovery attests this verification; it does not prove older sessions belong to this person.
      continuityOf = null;
      changes.recoveryAudit = { actor: recovery.staff, action: "evidence_recovered", target: verificationId, reason: recovery.reason };
    }
  }
  const updates = new Map(changes.update.map(row => [row.id, row]));
  const activating = new Set<EvidenceKind>();
  const activatingVerification = activation === "active" && ownFace?.activation !== "active";
  for (const row of own) {
    if (row.activation === "revoked" || row.activation === "superseded") continue;
    const restored = updates.get(row.id) ?? row;
    // Repair pre-unit-gate active non-face proofs as well as normal pending proofs.
    if (activatingVerification || row.activation !== activation || row.continuityOf !== continuityOf) {
      updates.set(row.id, { ...restored, activation, state: activation === "revoked" ? "invalidated" : activation,
        continuityOf, recoveredBy, recoveryReason, supersededAt: activation === "superseded" ? ownFace!.supersededAt : null });
      if (activation === "active") activating.add(row.kind);
    }
  }
  if (missing.length) {
    const established = decision.establishedAt;
    if (!established || !validDate(established) || established > now) throw new Error("MissingAuthoritativeEstablishedAt");
    for (const proof of missing) {
      if (proof.kind === "age" && (typeof proof.value !== "number" || !Number.isFinite(proof.value) || proof.value < 0)) throw new Error("InvalidAgeEvidence");
      if (activation === "active") activating.add(proof.kind);
      changes.insert.push({ accountId, verificationId, kind: proof.kind, value: proof.value, establishedAt: established,
        validUntil: new Date(established.getTime() + DEFAULT_TTL_DAYS[proof.kind] * 86400_000), providerStatus, activation, continuityOf,
        state: activation === "revoked" ? "invalidated" : activation,
        invalidatedAt: activation === "revoked" ? ownFace!.invalidatedAt : null,
        invalidatedReason: activation === "revoked" ? ownFace!.invalidatedReason : null,
        supersededAt: activation === "superseded" ? ownFace!.supersededAt : null, recoveredBy, recoveryReason });
    }
  }
  for (const row of rows) {
    if (row.verificationId !== verificationId && row.activation === "active" && activating.has(row.kind)) {
      updates.set(row.id, { ...row, activation: "superseded", state: "superseded", supersededAt: now });
    }
  }
  // The active-face uniqueness constraint also applies to updates of existing pending rows.
  changes.update = [...updates.values()].sort((a, b) => Number(b.activation === "superseded") - Number(a.activation === "superseded"));
  return changes;
}
/** C23: attendance remains historical. The admin flag is derived from the exact evidence used at check-in. */
export function verificationWithdrawnAfterCheckin(checkin: { faceEvidenceId: string | null; checkedInAt: Date }, evidence: readonly EvidenceFact[]): boolean {
  const face = evidence.find(row => row.id === checkin.faceEvidenceId);
  return !!face?.invalidatedAt && face.invalidatedAt >= checkin.checkedInAt;
}
