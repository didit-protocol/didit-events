import { missingChecks } from "@didit-events/core/domain/missing-checks";
import { baselinePolicy } from "@didit-events/core/identity/onboarding";
import { accountStaffRole } from "@didit-events/core/identity/sessions";
import { cookies } from "next/headers";
import { COOKIE_NAMES } from "@didit-events/core/http/policy";
import { getDb } from "@didit-events/core/db";
import { queryable } from "@didit-events/core/db/tx";
import { type EvidenceFact } from "@didit-events/core/domain";
import { camel } from "@didit-events/core/identity/shared";
import { IdentityError } from "@didit-events/core/identity";
import { identity } from "../auth/runtime";
import type { GuestAccount } from "./types";
import { photoSrc } from "./photo";
import { guestPage } from "../auth/access";

export async function currentGuest(next?: string): Promise<GuestAccount | null> {
  // Public surfaces may ask for an optional guest; private loaders pass their return path.
  const cookie = (await cookies()).get(COOKIE_NAMES.session)?.value;
  let principal;
  if (next) principal = await guestPage(next);
  else {
    if (!cookie) return null;
    try { principal = await identity.auth.requireGuest(cookie); } catch (error) { if (error instanceof IdentityError && error.status === 401) return null; throw error; }
  }
  const account = await identity.accounts.get(principal.accountId);
  if (!account) return null;
  const q = queryable(getDb());
  const proofs = (await q.query("select * from evidence where account_id=$1", [account.id])).map(row => camel<EvidenceFact>(row));
  const result = missingChecks({ ...account, evidence: proofs },baselinePolicy,new Date());
  const face = proofs.find(p => p.id === result.satisfied.face?.evidenceId);
  // The name counts as verified only while an ID document bound to this face carries the same name as the profile.
  const nameFromId = !!missingChecks({ ...account, evidence: proofs }, { ...baselinePolicy, checks: { ...baselinePolicy.checks, required: ["name_from_id"] } }, new Date()).satisfied.name_from_id;
  const google = (await q.query("select id from account_identities where account_id=$1 limit 1", [account.id])).length > 0;
  const [count] = await q.query<{ n: string }>("select count(distinct c.event_id) as n from checkins c join registrations r on r.id=c.registration_id where r.account_id=$1 and c.undone_at is null", [account.id]);
  return { staffRole: await accountStaffRole(q, account.id), id: account.id, firstName: account.firstName ?? "", lastName: account.lastName ?? "", email: account.email, company: account.company ?? undefined, role: account.jobRole ?? undefined, headline: account.headline ?? undefined, bio: account.bio ?? undefined, links: account.profileLinks, photoUrl: photoSrc(account.photoUrl, account.updatedAt), google: google ? { email: account.email } : undefined, marketingOptIn: account.marketingOptIn, eventsAttended: Number(count?.n ?? 0), verification: result.canSubmit && face ? { state: "verified", verifiedAt: face.establishedAt.toISOString(), selfieValidUntil: face.validUntil.toISOString(), nameFromId } : { state: "none" } };
}
