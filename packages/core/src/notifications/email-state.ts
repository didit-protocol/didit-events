import { registrationChecks } from "../admission/policies.ts";
import { eventBy, row } from "../admission/shared.ts";
import type { Queryable } from "../db/tx.ts";
import type { Registration } from "../domain/services.ts";
import { PermanentOutboxError } from "../outbox.ts";
import type { EmailPayload } from "./email.ts";

const CHECK_NOTICES = ["M-03", "M-05", "M-06", "M-11", "M-12", "M-23", "E-01"];
const LABELS: Record<string, string> = { face: "selfie", phone: "phone number", id_document: "ID document", name_from_id: "name from ID", age: "age" };
/** Queued notices use current admission and accepted checks, including renewals completed while queued. */
export async function currentEmailState(q: Queryable, payload: EmailPayload, now: Date) {
  if (!payload.accountId || !payload.eventId || !CHECK_NOTICES.includes(payload.code)) return {};
  const [stored] = await q.query("select * from registrations where account_id=$1 and event_id=$2", [payload.accountId,payload.eventId]);
  const event = await eventBy(q,payload.eventId);
  if (!stored || !event || stored.admission !== "approved" || !["published","live"].includes(event.status) || event.endsAt <= now)
    throw new PermanentOutboxError("suppressed_registration");
  const registration=row<Registration>(stored);
  const checks=await registrationChecks(q,registration,event,now,true);
  const renewal=["M-03","M-05","E-01"].includes(payload.code);
  if (renewal && checks.canSubmit) throw new PermanentOutboxError("suppressed_renewal_complete");
  if (["M-11","M-12"].includes(payload.code) && !checks.canSubmit) throw new PermanentOutboxError("suppressed_checks_required");
  return { renewalNeeded:!checks.canSubmit,renewalChecks:checks.missing.map(m=>LABELS[m.check]??m.check),statusUrl:`/me/events/${event.slug}` };
}
