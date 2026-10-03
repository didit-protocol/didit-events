import { guestPage } from "../../../../src/auth/access";
import { getDb } from "@didit-events/core/db";
import { queryable } from "@didit-events/core/db/tx";
import { currentGuest } from "../../../../src/accounts/session";
import { DELETION_GRACE_MS } from "@didit-events/core/identity/accounts";
import { identity } from "../../../../src/auth/runtime";
export async function getDeletionImpact(): Promise<{ upcoming: number; open: number } | null> {
  const account = await currentGuest("/me/settings/delete"); if (!account) return null;
  const [row] = await queryable(getDb()).query<{ upcoming: string; open: string }>("select count(*) filter(where r.admission='approved') as upcoming,count(*) filter(where r.admission in ('pending','waitlisted')) as open from registrations r join events e on e.id=r.event_id where r.account_id=$1 and e.ends_at>clock_timestamp()", [account.id]);
  return { upcoming: Number(row?.upcoming ?? 0), open: Number(row?.open ?? 0) };
}
/**
 * v5: the deletion waits out its grace period. This browser keeps its (now inert) session so every guest page can show
 * "Keep my account"; every other session is signed out at once and the account is disabled now, as before.
 */
export async function deleteAccount(): Promise<"deleted" | "sign_in"> { await identity.accounts.requestDeletion(await guestPage("/me/settings/delete", 900), { graceMs: DELETION_GRACE_MS }); return "deleted"; }
