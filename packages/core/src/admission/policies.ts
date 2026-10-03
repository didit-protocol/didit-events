import { createHash } from "node:crypto";
import type { Queryable } from "../db/tx.ts";
import type { EventChecks,EventForm } from "../domain/event-model.ts";
import { missingChecks } from "../domain/missing-checks.ts";
import { ModelError } from "../domain/model-error.ts";
import type { DomainEvent,Registration } from "../domain/services.ts";
import { accountFacts } from "../identity/onboarding.ts";
export async function acceptedEvent(q: Queryable, registration: Registration, event: DomainEvent): Promise<DomainEvent> {
  const [policy] = await q.query<{ checks: EventChecks; form: EventForm; version: number; form_version: number }>(
    "select * from event_policies where event_id=$1 and version=$2 and form_version=$3", [event.id,registration.policyVersion,registration.formVersion]);
  if (!policy) throw new ModelError("context_changed");
  return { ...event, checks: policy.checks, form: policy.form, policyVersion: policy.version, formVersion: policy.form_version };
}
export async function registrationChecks(q: Queryable, registration: Registration, event: DomainEvent, now: Date, entry = false) {
  const account = await accountFacts(q,registration.accountId), policy = await acceptedEvent(q,registration,event);
  const result = missingChecks(account,policy,now);
  if (entry && registration.legacyImported && registration.admission === "approved") result.canSubmit =
    !account.deletingAt && !account.deletedAt && result.baseline.email && result.baseline.face && !result.missing.length;
  return { account, policy, ...result };
}
export async function approvalChecks(q: Queryable, registration: Registration, event: DomainEvent, now: Date, automatic = false) {
  const result = await registrationChecks(q,registration,event,now);
  if (result.canSubmit && registration.requestReceipt && registration.requestCompletedAt) return result;
  const expiredOnly = !automatic && !!registration.requestReceipt && result.baseline.email && result.baseline.profile && result.missing.length > 0 &&
    result.missing.every(m => m.reason === "expired" && !!registration.requestReceipt!.evidenceIds[m.check]);
  if (!expiredOnly) throw new ModelError(registration.legacyImported ? "onboarding_required" : "checks_required", "The accepted checks need attention before approval");
  return result;
}

/** Stable across retries and workers; a new proof or accepted policy starts a new cause. */
export function renewalCause(checks: Awaited<ReturnType<typeof registrationChecks>>): string {
  const facts=checks.account.evidence.map(e=>[e.id,e.kind,e.establishedAt,e.validUntil,e.invalidatedAt,e.activation]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify([checks.policy.policyVersion,checks.missing.map(m=>[m.check,m.reason]),facts])).digest("hex");
}
