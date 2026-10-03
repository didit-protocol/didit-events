import type { Db } from "../db/index.ts";
import type * as schema from "../db/schema.ts";
import { withTx,type Queryable } from "../db/tx.ts";
import { displayStatus,type EvidenceSummary } from "../domain/display-status.ts";
import { eligibility } from "../domain/eligibility.ts";
import { profileSchema } from "../domain/event-model.ts";
import { missingChecks } from "../domain/missing-checks.ts";
import { profileDraft } from "../domain/profile.ts";
import type { Account,DomainEvent,Evidence,Registration,Verification } from "../domain/services.ts";
import { database,derivedEvent,eventBy,row } from "./shared.ts";

export interface RegistrationView {
  registration: Registration; account: Account; verification: Verification | null; evidence: Evidence[];
  /** Every verification of the account, newest first (the face proof's session may not be the latest attempt). */
  verifications: Verification[];
  status: ReturnType<typeof displayStatus>; eligible: boolean; waitlistPosition: number | null;
  checkedIn: typeof schema.checkins.$inferSelect | null; possibleDuplicate: boolean; returning: boolean; google: boolean; summary: EvidenceSummary;
}
export async function eventReadModel(id: string, db?: Db, now = new Date()) {
  return withTx(async tx => {
    if (tx.kind === "postgres") await tx.query("set transaction isolation level repeatable read read only");
    return readEventIn(tx, id, now);
  }, database(db));
}
export async function readEventIn(q: Queryable, id: string, now = new Date()) {
  const stored = await eventBy(q, id); if (!stored) return null;
  const event = derivedEvent(stored, now);
  const registrations = (await q.query("select * from registrations where event_id=$1 order by applied_at,id", [event.id])).map(r => row<Registration>(r));
  const accounts = (await q.query("select a.* from accounts a join registrations r on r.account_id=a.id where r.event_id=$1", [event.id])).map(r => row<Account>(r));
  const evidence = (await q.query("select e.* from evidence e join registrations r on r.account_id=e.account_id where r.event_id=$1", [event.id])).map(r => row<Evidence>(r));
  const verifications = (await q.query("select v.* from verifications v join registrations r on r.account_id=v.account_id where r.event_id=$1 order by v.created_at desc,v.id desc", [event.id])).map(r => row<Verification>(r));
  const checkins = (await q.query("select * from checkins where event_id=$1 order by checked_in_at desc,id", [event.id])).map(r => row<typeof schema.checkins.$inferSelect>(r));
  const scans = (await q.query("select * from scans where event_id=$1 order by created_at desc,id", [event.id])).map(r => row<typeof schema.scans.$inferSelect>(r));
  const kiosks = (await q.query("select * from kiosks where event_id=$1 order by name,id", [event.id])).map(r => row<typeof schema.kiosks.$inferSelect>(r));
  const history = (await q.query("select h.* from admission_history h join registrations r on r.id=h.registration_id where r.event_id=$1 order by h.created_at desc,h.id", [event.id])).map(r => row<typeof schema.admissionHistory.$inferSelect>(r));
  const identities = await q.query("select distinct i.account_id from account_identities i join registrations r on r.account_id=i.account_id where r.event_id=$1", [event.id]);
  const returning = await q.query("select distinct r.account_id from registrations r join checkins c on c.registration_id=r.id where r.event_id<>$1 and c.undone_at is null", [event.id]);
  const invites = (await q.query("select * from invites where event_id=$1", [event.id])).map(r => row<typeof schema.invites.$inferSelect>(r));
  const outbox = await q.query("select kind,status,coalesce(payload->>'registrationId',payload->'data'->>'registrationId') as registration_id from outbox where payload->>'eventId'=$1", [event.id]);
  const waitlist = registrations.filter(r => r.admission === "waitlisted");
  const approvedCount = registrations.filter(r => r.admission === "approved").length;
  const policies=(await q.query("select * from event_policies where event_id=$1",[event.id])).map(r=>row<{version:number;checks:DomainEvent["checks"];form:DomainEvent["form"]}>(r));
  const views: RegistrationView[] = registrations.map(registration => {
    const account = accounts.find(a => a.id === registration.accountId)!;
    const proofs = evidence.filter(e => e.accountId === account.id), policy=policies.find(p=>p.version===registration.policyVersion)!, accepted={...event,checks:policy.checks,form:policy.form}, facts=missingChecks({...account,evidence:proofs},accepted,now), proof = eligibility({ ...account, evidence: proofs }, accepted,now);
    const verification = verifications.find(v => v.accountId === account.id) ?? null;
    const checkedIn = checkins.find(c => c.registrationId === registration.id && !c.undoneAt) ?? null;
    const previous = history.find(h => h.registrationId === registration.id && h.to === "cancelled_by_guest");
    const missing = facts.missing.map(m=>m.check==="id_document"||m.check==="name_from_id"?"document" as const:m.check);
    const summary: EvidenceSummary = {
      signedIn: true, profileComplete: profileSchema.safeParse(profileDraft(account)).success, profileVerified: facts.baseline.email,
      deleting: !!account.deletingAt, deleted: !!account.deletedAt, eligible: proof.eligible, missing,
      reused: proof.eligible && !!verification && verification.createdAt < registration.createdAt,
      previouslyEligible: proofs.some(e => e.activation === "active" || e.activation === "superseded"),
      verification: verification?.status === "created" ? "not_started" : verification?.status === "abandoned" || verification?.status === "superseded" ? "expired" : verification?.status ?? "not_started",
    };
    const invited = false;
    const status = displayStatus({ ...event, approvedCount }, { ...registration, invited, checkedIn: !!checkedIn, withdrawn: previous?.from === "pending" }, summary, now);
    return { registration, account, verification, verifications: verifications.filter(v => v.accountId === account.id), evidence: proofs, status, summary, eligible: proof.eligible, waitlistPosition: registration.admission === "waitlisted" ? waitlist.findIndex(r => r.id === registration.id) + 1 : null, checkedIn,
      possibleDuplicate: accounts.some(a => a.id !== account.id && a.email !== account.email && !!account.firstName && !!account.lastName && a.firstName?.trim().toLowerCase() === account.firstName.trim().toLowerCase() && a.lastName?.trim().toLowerCase() === account.lastName.trim().toLowerCase()) || !!verification?.decision && JSON.stringify(verification.decision).includes("POSSIBLE_DUPLICATE"),
      returning: returning.some(r => r.account_id === account.id), google: identities.some(r => r.account_id === account.id),
    };
  });
  const registeredEmails = new Set(accounts.map(a => a.email));
  const activeInvites = invites.filter(i => i.email && !i.revokedAt && i.expiresAt > now && i.uses < i.maxUses && !registeredEmails.has(i.email));
  // The reason a cancelled event was cancelled with: only the audit row keeps it.
  const cancelReason = stored.status === "cancelled" ? ((await q.query<{ reason: string | null }>("select data->>'reason' as reason from audit where event_id=$1 and action='event.cancelled' order by created_at desc,id desc limit 1", [event.id]))[0]?.reason ?? null) : null;
  return { event, views, registrations, accounts, checkins, scans, kiosks, history, invites, activeInvites, outbox, approvedCount, cancelReason };
}
export function signedOutStatus(event: DomainEvent, approvedCount: number, now = new Date()) {
  return displayStatus({ ...event, approvedCount }, null, { signedIn: false, eligible: false, verification: "not_started" }, now);
}
