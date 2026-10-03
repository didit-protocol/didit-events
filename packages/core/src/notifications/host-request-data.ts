// Send-time data for the host emails (M-25, M-26). The outbox row holds references only (registration id or the
// digest window); the profile, answers and counts are read when the email is sent, so hosts see current values and
// a request decided or withdrawn meanwhile is not announced. Never reads the selfie, face evidence or decision data;
// the profile photo (accounts.photo) is shrunk and sent inline, never as a link.
import type { Queryable } from "../db/tx.ts";
import type { Application,EventForm,ProfileDraft } from "../domain/event-model.ts";
import type { HostApplicant,HostRequestCounts } from "../email/index.ts";
import { PermanentOutboxError } from "../outbox.ts";
import { DIGEST_PHOTOS,inlinePhoto,type InlineImage } from "./inline-photo.ts";
import { LEGACY_TEAM_MAILBOX } from "./resend.ts";

/** Template fields plus the inline photos the message must attach. */
export interface HostEmailData { data: Record<string, unknown>; inline: InlineImage[] }

const OPEN = ["pending", "waitlisted"];
const CHECK_LABELS: Record<string, string> = { phone: "Phone", id_document: "ID document", name_from_id: "Name from ID", age: "Age" };

export const applicantsUrl = (baseUrl: string, eventId: string, registrationId?: string) =>
  `${baseUrl}/admin/events/${eventId}/applicants${registrationId ? `?applicant=${registrationId}` : ""}`;

async function counts(q: Queryable, eventId: string): Promise<HostRequestCounts> {
  const [row] = await q.query<{ pending: number; waitlisted: number; approved: number; capacity: number }>(`select e.capacity,
    (select count(*)::int from registrations r where r.event_id=e.id and r.admission='pending') pending,
    (select count(*)::int from registrations r where r.event_id=e.id and r.admission='waitlisted') waitlisted,
    (select count(*)::int from registrations r where r.event_id=e.id and r.admission='approved') approved
    from events e where e.id=$1`, [eventId]);
  if (!row) throw new PermanentOutboxError("missing_event");
  return { pending: row.pending, waitlisted: row.waitlisted, capacity: row.capacity, capacityLeft: Math.max(0, row.capacity - row.approved) };
}

const nameOf = (a: { full_name: string | null; first_name: string | null; last_name: string | null; email: string }) =>
  a.full_name?.trim() || [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || a.email.split("@")[0]!;

function display(value: unknown, question: EventForm["questions"][number]): string {
  const one = (v: unknown) => "options" in question ? question.options.find(o => o.id === v)?.label ?? String(v ?? "") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v ?? "");
  return Array.isArray(value) ? value.map(one).join(", ") : one(value);
}

/** The recipient must still be active staff when the email goes out. */
async function activeStaff(q: Queryable, to: string): Promise<void> {
  const [staff] = await q.query("select 1 from staff where email=$1 and disabled_at is null", [to.toLowerCase()]);
  if (!staff) throw new PermanentOutboxError("suppressed_staff");
}

/**
 * Host notices go To the first host with the others in CC. At send time keep only hosts who are still active staff,
 * never the guest and never the team mailbox (Reply-To only: a suppressed recipient blocks the whole message), then
 * re-seat To/CC on the payload; nothing left → suppressed. Rows queued before 2026-10-02 carry the mailbox in `to`
 * and every host in `cc` and are re-seated the same way. A row with one host and no `cc` keeps the per-recipient check.
 */
async function hostAudience(q: Queryable, payload: { to?: string; cc?: string[] }, guestEmail?: string): Promise<void> {
  const to = payload.to!.toLowerCase(), guest = guestEmail?.toLowerCase();
  if (!payload.cc && to !== LEGACY_TEAM_MAILBOX) { await activeStaff(q, to); if (guest === to) throw new PermanentOutboxError("suppressed_guest_recipient"); return; }
  const named = [...new Set([to, ...(payload.cc ?? [])].map(c => c.toLowerCase()))].filter(c => c !== LEGACY_TEAM_MAILBOX && c !== guest);
  const rows = await q.query<{ email: string }>("select email from staff where email = any($1::text[]) and disabled_at is null", [named]);
  const live = new Set(rows.map(r => r.email.toLowerCase()));
  const [first, ...rest] = named.filter(c => live.has(c));
  if (!first) throw new PermanentOutboxError("suppressed_staff");
  payload.to = first; payload.cc = rest;
}

export async function hostRequestData(q: Queryable, payload: { to?: string; cc?: string[]; eventId?: string }, data: Record<string, unknown>, baseUrl: string): Promise<HostEmailData> {
  if (!payload.to || !payload.eventId) throw new PermanentOutboxError("invalid_payload");
  const registrationId = data.registrationId;
  if (typeof registrationId !== "string") throw new PermanentOutboxError("invalid_registration");
  const [r] = await q.query<{ admission: string; reapplication_count: number; applied_at: Date; policy_version: number; application_v2: Application | null; application: Record<string, unknown>; application_purged_at: Date | null;
    request_receipt: { evidenceIds?: Record<string, string> } | null; email: string; full_name: string | null; first_name: string | null; last_name: string | null; headline: string | null; company: string | null;
    job_role: string | null; profile_links: ProfileDraft["links"] | null; form: EventForm | null; deleted: boolean; photo: Uint8Array | null }>(`select r.admission,r.reapplication_count,r.applied_at,r.policy_version,r.application_v2,r.application,r.application_purged_at,r.request_receipt,
      a.email,a.full_name,a.first_name,a.last_name,a.headline,a.company,a.job_role,a.profile_links,(a.deleting_at is not null or a.deleted_at is not null) deleted,
      case when a.deleting_at is null and a.deleted_at is null then a.photo end photo,
      (select p.form from event_policies p where p.event_id=r.event_id and p.version=r.policy_version) form
    from registrations r join accounts a on a.id=r.account_id where r.id=$1 and r.event_id=$2`, [registrationId, payload.eventId]);
  if (!r || r.deleted || !OPEN.includes(r.admission) || r.application_purged_at) throw new PermanentOutboxError("suppressed_registration");
  // Queued for an earlier application (withdrawn, then re-applied): the new application has its own notice. Rows
  // queued before the count was stored carry none and keep the open-admission check alone.
  if (data.reapplicationCount !== undefined && data.reapplicationCount !== r.reapplication_count) throw new PermanentOutboxError("suppressed_registration");
  await hostAudience(q, payload, r.email);
  const name = nameOf(r);
  const answers = (r.form?.questions ?? []).flatMap(question => {
    const value = r.application_v2?.answers[question.id] ?? r.application[question.id];
    const answer = value === undefined || value === null ? "" : display(value, question).trim();
    return answer ? [{ question: question.label, answer }] : [];
  });
  const photo = await inlinePhoto(r.photo, 1);
  const applicant: HostApplicant = { name, email: r.email, photoUrl: photo ? `cid:${photo.content_id}` : null, headline: r.headline ?? "", company: r.company ?? "", jobRole: r.job_role ?? "",
    links: (r.profile_links ?? []).filter(l => l.kind === "linkedin" || l.kind === "website"), phone: r.application_v2?.fields.phone_number ?? null };
  return { inline: photo ? [photo] : [], data: {
    kind: r.admission === "waitlisted" ? "waitlist" : "request", applicant, answers, requestedAt: r.applied_at,
    verifiedChecks: Object.keys(r.request_receipt?.evidenceIds ?? {}).filter(k => k in CHECK_LABELS).map(k => CHECK_LABELS[k]!),
    counts: await counts(q, payload.eventId),
    reviewUrl: applicantsUrl(baseUrl, payload.eventId, registrationId), allRequestsUrl: applicantsUrl(baseUrl, payload.eventId),
  } };
}

export async function hostDigestData(q: Queryable, payload: { to?: string; cc?: string[]; eventId?: string }, data: Record<string, unknown>, baseUrl: string): Promise<HostEmailData> {
  if (!payload.to || !payload.eventId) throw new PermanentOutboxError("invalid_payload");
  // A notice for one host leaves out that host's own request; one shared by several hosts lists every folded request.
  await hostAudience(q, payload);
  // Every recipient (To and CC, after the audience filter) is left out of the folded list: a host who applied never
  // receives a notice about their own request.
  const recipients = [payload.to, ...(payload.cc ?? [])].map(e => e.toLowerCase());
  const { windowStart, windowEnd } = data;
  if (!(windowStart instanceof Date) || !(windowEnd instanceof Date)) throw new PermanentOutboxError("invalid_window");
  // Folded requests: open requests of this window that did not get their own M-25. Only the first DIGEST_PHOTOS rows
  // read their photo bytes.
  const rows = await q.query<{ admission: string; applied_at: Date; email: string; full_name: string | null; first_name: string | null; last_name: string | null; headline: string | null; company: string | null; photo: Uint8Array | null }>(`
    select r.admission,r.applied_at,a.email,a.full_name,a.first_name,a.last_name,a.headline,a.company,
      case when row_number() over (order by r.applied_at,r.id) <= $5 then a.photo end photo
    from registrations r join accounts a on a.id=r.account_id
    where r.event_id=$1 and r.admission in ('pending','waitlisted') and r.applied_at>=$2 and r.applied_at<$3 and a.deleting_at is null and a.deleted_at is null
      and not (lower(a.email) = any($4::text[]))
      and not exists (select 1 from outbox o where o.kind='email:M-25' and o.dedupe_key like 'email:M-25:'||r.event_id::text||':'||r.id::text||':'||r.reapplication_count::text||':%')
    order by r.applied_at,r.id`, [payload.eventId, windowStart, windowEnd, recipients, DIGEST_PHOTOS]);
  if (!rows.length) throw new PermanentOutboxError("suppressed_no_requests");
  const photos = await Promise.all(rows.map((r, i) => i < DIGEST_PHOTOS ? inlinePhoto(r.photo, i + 1) : null));
  return { inline: photos.filter((p): p is InlineImage => !!p), data: {
    windowStart, counts: await counts(q, payload.eventId), allRequestsUrl: applicantsUrl(baseUrl, payload.eventId),
    requests: rows.map((r, i) => ({ name: nameOf(r), headline: r.headline ?? "", company: r.company ?? "", kind: r.admission === "waitlisted" ? "waitlist" : "request", requestedAt: r.applied_at,
      photoUrl: photos[i] ? `cid:${photos[i].content_id}` : null })),
  } };
}
