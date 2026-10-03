import { guestPage } from "../../../src/auth/access";
import { publicEvent, eventReadModel, guestAccount } from "../../../src/server/b4-views";
import { read } from "@didit-events/core/admission/shared";
import type { GuestAccount, MyEvent } from "../../../src/accounts/types";
import { photoSrc } from "../../../src/accounts/photo";
import { rejoinOf } from "@didit-events/core/admission/requests";
import { reapplicable } from "@didit-events/core/admission/rejoin";
import { accountLinks } from "../../../src/accounts/links";
import { rejoinCopy } from "../../../src/accounts/join/rejoin-words";
import { shortDate } from "../../../src/public/format";
export async function getMyEvents(_preview?: string): Promise<{ account: GuestAccount; events: MyEvent[] } | null> {
 const principal = await guestPage("/me/events");
 const ids = await read().query<{ event_id: string }>("select event_id from registrations where account_id=$1 order by applied_at desc", [principal.accountId]);
 // Each registration's event is independent: read together (the order of `ids` is kept), not one after another.
 const rows = await Promise.all(ids.map(async ({ event_id }) => { const m = await eventReadModel(event_id), v = m?.views.find(v => v.account.id === principal.accountId); if (!m || !v) return null;
  const s = v.status.status;
  const badge: MyEvent["badge"] = s === "checked_in" ? "checked-in" : v.eligible && v.registration.admission === "approved" ? "going" : s === "waitlist" ? "waitlist" : s === "pending" ? "pending" : v.registration.admission === "rejected" ? "not-approved" : s === "ended" ? (v.checkedIn ? "attended" : "no-show") : s === "in_review" || s === "requirements_unmet" ? "in-review" : s === "declined" ? "declined" : v.registration.admission === "approved" ? "approved" : "cancelled";
  // v5: the same rule as the join modal decides whether "Request again" is offered on the row.
  const again = reapplicable(v.registration.admission) ? await rejoinOf(read(), v.registration, m.event, new Date(), !!v.checkedIn) : null;
  // The row's detail is when and where ("Thu 8 Oct · Didit HQ"); the status is the pill's job alone.
  const event = publicEvent(m.event, m.approvedCount);
  const row: MyEvent = { event, badge, detail: `${shortDate(event.startsAt, event.timeZone)} · ${event.venue.name}`, ...(again?.canRequest ? { again: { label: rejoinCopy(again).action, href: accountLinks.join(m.event.slug) } } : {}) };
  return { row, account: guestAccount(v) };
 }));
 const found = rows.filter(r => r !== null), events = found.map(r => r.row);
 let account: GuestAccount | null = found.at(-1)?.account ?? null;
 if (!account) {
  const [a] = await read().query("select * from accounts where id=$1 and deleting_at is null and deleted_at is null", [principal.accountId]); if (!a) return null;
  account = { id: principal.accountId, firstName: String(a.first_name ?? ""), lastName: String(a.last_name ?? ""), email: String(a.email), photoUrl: photoSrc(a.photo_url as string | null, a.updated_at as Date | null), links: [], verification: { state: "none" }, marketingOptIn: false, eventsAttended: 0 };
 }
 return { account, events };
}
