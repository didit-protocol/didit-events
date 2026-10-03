import { getDb } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import { PermanentOutboxError,type OutboxRegistry } from "../outbox.ts";
import { emailHandler,encodeData,type EmailConfig } from "./email.ts";
import { agendaItems } from "./lifecycle.ts";

/** B1/B3's durable message kinds and dedupe keys predate B5. Preserve those keys on retries. */
export function registerRegistrationEmails(registry: OutboxRegistry, config: EmailConfig) {
  const send = emailHandler(config);
  for (const code of ["M-03", "M-13"] as const) registry.register(code, async (message, context) => {
    const registrationId = message.payload?.registrationId;
    if (typeof registrationId !== "string" || !/^[0-9a-f-]{36}$/i.test(registrationId)) throw new PermanentOutboxError("invalid_registration");
    const q = queryable(config.db ?? getDb());
    const [row] = await q.query<{ account_id: string; event_id: string; admission: string; status: string; slug:string; ends_at: Date; checked_in_at: Date | null; timezone: string; agenda: { at?: string; endAt?: string; label?: string }[] }>(`select r.account_id,r.event_id,r.admission,e.status,e.slug,e.ends_at,e.timezone,e.agenda,
      (select min(c.checked_in_at) from checkins c where c.registration_id=r.id and c.undone_at is null) checked_in_at
      from registrations r join events e on e.id=r.event_id where r.id=$1`, [registrationId]);
    if (!row || row.admission !== "approved" || row.status === "cancelled") throw new PermanentOutboxError("suppressed_registration");
    let data: Record<string, unknown>;
    if (code === "M-03") {
      if (row.ends_at <= new Date()) throw new PermanentOutboxError("event_ended");
      data = { verifyUrl: `/me/events/${row.slug}`, linkExpiresAt: row.ends_at };
    } else {
      if (!row.checked_in_at) throw new PermanentOutboxError("checkin_undone");

      data = { checkedInAt: row.checked_in_at, arrivalNote: "Enjoy the event.",
        tonight: agendaItems((Array.isArray(row.agenda) ? row.agenda : []).filter(item => item?.at && item.label && Number.isFinite(Date.parse(item.at))), row.timezone) };
    }
    context.signal.throwIfAborted();
    return send({ ...message, kind: `email:${code}`, payload: { code, accountId: row.account_id, eventId: row.event_id, data: encodeData(data) } }, context);
  });
}
