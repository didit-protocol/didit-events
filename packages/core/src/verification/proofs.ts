import { establishedAt, type DiditDecision } from "../didit/types.ts";
import type { Account, Verification } from "../domain/services.ts";
import type { EvidenceDecision } from "../domain/evidence.ts";
import type { WorkflowKind } from "./shared.ts";

export function providerState(status: DiditDecision["status"]): Verification["status"] {
  switch (status) {
    case "Approved": return "approved";
    case "Declined": return "declined";
    case "In Review": return "in_review";
    case "Expired": case "Kyc Expired": return "expired";
    case "Abandoned": return "abandoned";
    case "Not Started": return "created";
    default: return "started";
  }
}
export const terminal = (status: string): boolean => ["Approved", "Declined", "Expired", "Kyc Expired", "Abandoned"].includes(status);
export function bindProofs(decision: DiditDecision, account: Account, workflow: WorkflowKind, now: Date, acceptedEmail?: string | null) {
  const names = new Map<string, string>();
  for (const response of decision.questionnaire_responses ?? []) {
    if (response.status !== "Approved") continue;
    for (const section of response.sections) for (const item of section.items) {
      if (item.value && typeof item.answer?.value === "string" && item.answer.value.trim()) names.set(item.value, item.answer.value.trim());
    }
  }
  const emails = (decision.email_verifications ?? []).filter(email => email.status === "Approved" && email.verified_at && Number.isFinite(Date.parse(email.verified_at)) && new Date(email.verified_at) <= now);
  const email = emails.find(email => email.email.trim().toLowerCase() === account.email) ?? emails[0];
  const emailMatches = !!email && email.email.trim().toLowerCase() === account.email;
  const emailBound = emailMatches || !!email && email.email.trim().toLowerCase() === acceptedEmail;
  const firstName = names.get("first_name") ?? null, lastName = names.get("last_name") ?? null;
  const live = (decision.liveness_checks ?? []).filter(row => row.status === "Approved");
  const age = live.find(row => typeof row.age_estimation === "number" && Number.isFinite(row.age_estimation) && row.age_estimation >= 0)?.age_estimation ?? null;
  const established = establishedAt(decision);
  let reason: string | null = null;
  if (decision.status === "Approved") {
    if (workflow !== "renewal" && email && !emailBound) reason = "verified a different email";
    else if (workflow !== "renewal" && (!emailBound || !firstName || !lastName)) reason = "identity proof incomplete";
    else if (!live.length || (workflow === "age" && age === null)) reason = "workflow proof incomplete";
    else if (!established || established > now) reason = "approval timestamp unavailable";
  }
  const proofs: EvidenceDecision["proofs"][number][] = [];
  if (decision.status === "Approved" && !reason) {
    if (workflow !== "renewal") proofs.push({ kind: "identity", value: { firstName, lastName, email: email!.email.trim().toLowerCase() } });
    proofs.push({ kind: "face", value: null });
    if (workflow === "age") proofs.push({ kind: "age", value: age });
  }
  return { proofs, matches: live.flatMap(row => row.matches), firstName, lastName, verifiedEmail: email?.email.trim().toLowerCase() ?? null,
    emailMatches: workflow === "renewal" ? null : emailMatches, age, established, reason };
}
