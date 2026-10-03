import { cache } from "react";
import { eventCreateSchema } from "@didit-events/core/domain/event-model";
import type { GuestRegistrationView } from "@didit-events/core/contracts/event-model";
import type { DomainEvent } from "@didit-events/core";
import { eventService } from "@didit-events/core";
import { eventReadModel,type RegistrationView } from "@didit-events/core/admission/read-model";
import { eventCoverUrl, eventWideCoverUrl } from "@didit-events/core/content/event-assets";
import { renderSafeMarkdown } from "@didit-events/core/content/markdown";
import { photoSrc } from "../accounts/photo";
import { displayName,personSummary,type PersonAccess } from "./b4-person";
import { publicHosts,type HostEntry } from "./hosts";
import type { GuestAccount,GuestEventStatus } from "../accounts/types";
import type { ApplicantRow,ApplicantsEvent } from "../admin/applicants/types";
import { addDays, agendaInstant, localInstant } from "../admin/form/editor";
export { localInstant };
import type { EventInput } from "../admin/form/types";
import { COUNTRIES,splitAddress } from "../admin/form/validate";
import type { AdminEventStatus,EventHeaderInfo } from "../admin/types";
import { requireEventAccess } from "../auth/access";
import { identity } from "../auth/runtime";
import type { CardState,PublicEvent } from "../public/types";
import type { Rejoin } from "@didit-events/core/contracts/event-model";
import { rejoinCopy } from "../accounts/join/rejoin-words";

export { eventReadModel };
/**
 * One read model per event per render (React cache): a tab's loaders (list, drawer seed, modal data) share one
 * snapshot instead of each reading it again. Only the read is shared, never the access check. React memoizes inside a
 * server render only: server actions and route handlers still read fresh on every call, so a read after a write is
 * never stale. Callers must not mutate the model.
 */
const readModelOnce = cache((id: string) => eventReadModel(id));
/** The admin read model of one event; every caller already named its own capability, this re-checks the floor (event.view). */
export async function adminModel(id: string) { await requireEventAccess(id, "event.view"); return readModelOnce(id); }
export const adminStatus = (event: DomainEvent): AdminEventStatus => event.status === "published" ? (new Date() >= event.startsAt ? "live" : "open") : event.status;
export const fmt = (event: DomainEvent, date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: event.timezone, ...options }).format(date);
/** The picked Google Maps place, else a Maps search for the venue and address (opens in a new tab). */
/** The embedded map's pin: the picked place's coordinates; undefined → the page falls back to venue + address text. */
export const mapQuery = (event: { lat?: number | null; lng?: number | null }) => (event.lat != null && event.lng != null ? `loc:${event.lat},${event.lng}` : undefined);
export function mapsLink(event: Pick<DomainEvent, "mapsUrl" | "venue" | "address">): string {
  if (event.mapsUrl?.startsWith("https://")) return event.mapsUrl;
  const query = [event.venue, event.address].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
/**
 * The city shown next to the venue: an explicit content override, else the city segment of the saved address. A
 * picked place stores Google's formatted address, manual entry the composed "street, postal city, country"; the
 * city is the last segment after the street once the country, postal code and any state code are dropped
 * ("…, San Francisco, CA 94105, USA" → San Francisco). No such segment → no city, never a guessed default.
 */
export function eventCity(event: Pick<DomainEvent, "address">, override?: string): string | undefined {
  if (override?.trim()) return override.trim();
  const segments = (event.address ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const code = (x: string) => /^[A-Z]{2,3}$/.test(x);
  if (segments.length > 1 && (COUNTRIES.some((c) => c.toLowerCase() === segments.at(-1)!.toLowerCase()) || code(segments.at(-1)!))) segments.pop();
  for (let i = segments.length - 1; i >= 1; i--) {
    const name = splitAddress(`street, ${segments[i]}`).city.trim();
    if (name && !code(name) && !/^[\d -]+$/.test(name)) return name;
  }
  return undefined;
}
export function publicEvent(event: DomainEvent, going = 0, attended = 0): PublicEvent {
  const content = (event.cover ?? {}) as Partial<PublicEvent> & { theme?: PublicEvent["cover"]["theme"] };
  return Object.assign({ slug: event.slug, title: event.name, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(), timeZone: event.timezone,
    lifecycle: event.status === "draft" ? "published" : event.status, registration: event.form.mode, registrationClosesAt: event.form.closes_at??undefined, capacity: event.capacity, going, attended,
    template: content.template ?? "feature", summary: event.description, about: content.about ?? [event.description], agenda: publicAgenda(event.agenda), panels: content.panels ?? [], hosts: publicHosts(event.id, (event.speakers ?? []) as HostEntry[]),
    venue: { name: event.venue ?? "", address: event.address ?? "", shortAddress: event.address ?? "", city: eventCity(event, content.venue?.city), mapsUrl: mapsLink(event), mapQuery: mapQuery(event), placeId: event.placeId ?? undefined, lat: event.lat ?? undefined, lng: event.lng ?? undefined },
    goingPreview: { initials: [], names: [] }, guestList: (content as { privacy?: { guestList?: PublicEvent["guestList"] } }).privacy?.guestList ?? "hidden", cover: Object.assign({ theme: content.theme ?? "aqua" }, { url: eventCoverUrl(event.id, event.cover), src: eventCoverUrl(event.id, event.cover), wideSrc: eventWideCoverUrl(event.id, event.cover), alt: event.cover.kind === "asset" ? event.cover.alt : event.name }), related: content.related ?? [], audience: content.audience ?? "guests", wifi: content.wifi,
  },{id:event.id,descriptionHtml:renderSafeMarkdown(event.descriptionMd),checks:event.checks,door:{kiosk:event.door.kiosk},form:event.form,policyVersion:event.policyVersion,formVersion:event.formVersion});
}
export function guestAccount(view: RegistrationView): GuestAccount {
  const a = view.account, face = view.evidence.find(e => e.kind === "face" && e.activation === "active" && e.providerStatus === "approved");
  return { id: a.id, firstName: a.firstName ?? "", lastName: a.lastName ?? "", email: a.email, links: a.profileLinks, headline:a.headline??undefined,bio:a.bio??undefined,photoUrl: photoSrc(a.photoUrl, a.updatedAt), google: view.google ? { email: a.email } : undefined, marketingOptIn: false, eventsAttended: view.returning ? 1 : 0,
    company: a.company??undefined, role: a.jobRole??undefined,
    verification: face && !!a.emailVerifiedAt && face.validUntil>new Date() && !face.invalidatedAt ? { state: "verified", verifiedAt: face.establishedAt.toISOString(), selfieValidUntil: face.validUntil.toISOString() } : { state: "none" } };
}
export function guestStatus(view: RegistrationView, event: DomainEvent, registration?: GuestRegistrationView): GuestEventStatus {
  if (registration) {
    let status:GuestEventStatus;
    if(event.status === "cancelled") status={kind:"event_cancelled"};
    else if(event.status === "ended") status={kind:"ended",attended:registration.checkedInAt?1:0,audience:"guests",attendance:registration.checkedInAt?"attended":registration.admission==="approved"?"no_show":"none"};
    else if(registration.checkedInAt) status={kind:"checked_in",at:registration.checkedInAt,door:view.checkedIn?.method === "manual"?"Manual check-in":"Event entrance"};
    else if(registration.admission === "approved") status=registration.readiness === "ready" ? {kind:"going",verifiedAt:view.registration.updatedAt.toISOString(),reused:false} : {kind:"checks_required",missing:registration.missing};
    else if(registration.admission === "pending") status={kind:"pending",requestedAt:view.registration.appliedAt.toISOString(),replyBy:event.startsAt.toISOString(),justRequested:false,via:view.google?"google":"email"};
    else if(registration.admission === "waitlisted") status={kind:"waitlisted",position:registration.waitlistPosition ?? 1};
    else if(registration.admission === "rejected") status={kind:"not_approved"};
    else if(registration.admission === "cancelled_by_guest") status={kind:"withdrawn"};
    else status={kind:registration.admission};
    return {...status,registration};
  }
  const r = view.registration, status = view.status.status;
  switch (status) {
    case "pending": return { kind: "pending", requestedAt: r.appliedAt.toISOString(), replyBy: event.startsAt.toISOString(), justRequested: false, via: view.google ? "google" : "email" };
    case "waitlist": return { kind: "waitlisted", position: view.waitlistPosition ?? 1 };
    case "rejected": return { kind: "not_approved" };
    case "withdrawn": return { kind: "withdrawn" };
    case "cancelled": return { kind: "cancelled", reason: r.reason ?? undefined, justCancelled: false };
    case "cancelled_by_host": case "event_cancelled": case "revoked": case "deleted": case "invited": case "verifying": case "requirements_unmet": return { kind: status };
    case "checked_in": return { kind: "checked_in", at: view.checkedIn!.checkedInAt.toISOString(), door: view.checkedIn!.method === "manual" ? "Manual check-in" : "Event entrance" };
    case "ended": case "no_show": return { kind: "ended", attended: view.checkedIn ? 1 : 0, audience: "guests", attendance: view.checkedIn ? "attended" : view.status.attendanceStatus === "no_show" ? "no_show" : "none" };
    case "verified": case "going": case "reused": return { kind: "going", verifiedAt: view.verification?.decidedAt?.toISOString() ?? r.updatedAt.toISOString(), reused: status === "reused" };
    case "in_review": return { kind: "in_review" };
    case "declined": return { kind: "declined", attemptsLeft: 0 };
    case "expired": return { kind: "link_expired" };
    case "re_verify": return { kind: "selfie_expired", expiredAt: view.evidence.find(e => e.kind === "face")?.validUntil.toISOString() ?? event.endsAt.toISOString() };
    default: return { kind: "approved", linkExpiresAt: event.endsAt.toISOString() };
  }
}
/** `again` (v5): the server's re-join decision for this registration (see core admission/rejoin.ts). */
export function cardStatus(view: RegistrationView, event: DomainEvent, again?: Rejoin): CardState {
  const s = guestStatus(view, event), viewer = guestAccount(view);
  const offer = again ? { label: again.canRequest ? rejoinCopy(again).action : null, rule: again.rule } : undefined;
  switch (s.kind) {
    case "pending": return { kind: "pending", viewer, requestedAt: s.requestedAt, replyBy: s.replyBy };
    case "going": return { kind: "going", viewer };
    case "checked_in": return { kind: "checked_in", viewer, checkedInAt: s.at, door: s.door };
    case "waitlisted": return { kind: "waitlist", position: s.position };
    case "declined": return s;
    case "ended": return { kind: "ended", attendance: s.attendance };
    case "not_approved": return offer ? { kind: "not_approved", again: offer } : { kind: "not_approved" };
    case "cancelled": case "in_review": return { kind: s.kind };
    case "withdrawn": return { kind: "cancelled", by: again?.kind === "withdrew" ? "withdrew" : "guest", ...(offer ? { again: offer } : {}) };
    case "cancelled_by_host": case "revoked": return { kind: "cancelled", by: "host" };
    case "event_cancelled": return { kind: "cancelled", by: "event" };
    case "deleted": return { kind: "cancelled" };
    default: return view.status.status === "verifying" ? { kind: "verifying", stepsDone: 0 } : { kind: "approved", linkExpiresAt: event.endsAt.toISOString() };
  }
}
/** dd/mm/yyyy in the event's zone (UTC without an event), never the server's own zone. */
export const shortDate = (date: Date, timeZone = "UTC") => new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
const tabs = { pending: "pending", approved: "approved", waitlisted: "waitlist", rejected: "rejected", cancelled_by_guest: "cancelled", cancelled_by_host: "cancelled", revoked: "cancelled" } as const;
/** One Requests row; with the event, the row also gets the photo + verified badge. */
export function applicantRow(view: RegistrationView, event?: Pick<DomainEvent, "id" | "timezone">, now = new Date(), access: PersonAccess = { photos: false }): ApplicantRow {
  const r = view.registration, a = view.account;
  return { id: r.id, name: displayName(view), ...(event ? { person: { ...personSummary(event.id, view, now, access), timeZone: event.timezone } } : {}), email: a.email, signIn: view.google ? "google" : "email", company: a.company ?? "—", role: a.jobRole ?? "—", why: a.bio ?? "—", tab: tabs[r.admission], verified: view.eligible, requested: shortDate(r.appliedAt, event?.timezone), position: view.waitlistPosition ?? undefined,
    signals: [...(view.eligible ? [{ label: "Verified before", tone: "ok" as const }] : []), ...(view.returning ? [{ label: "Attended before", tone: "brand" as const }] : []), ...(view.possibleDuplicate ? [{ label: "Possible duplicate", tone: "warn" as const }] : []), ...(!view.evidence.length && !view.returning ? [{ label: "New account", tone: "neu" as const }] : [])],
    approval: r.admission === "approved" ? { line: view.status.label, status: view.status.status === "invited" ? "invited" : view.eligible ? "going" : view.status.status === "in_review" || view.status.status === "requirements_unmet" ? "in-review" : view.status.status === "verifying" ? "verifying" : view.status.status === "declined" ? "declined" : view.status.status === "expired" ? "expired" : "link-sent" } : undefined,
    rejection: r.admission === "rejected" ? { reason: r.reason ?? "", emailed: true } : undefined,
    cancellation: tabs[r.admission] === "cancelled" ? { reason: r.reason ?? "", when: shortDate(r.updatedAt, event?.timezone), late: r.lateCancellation } : undefined };
}
/**
 * Why an event takes no requests, null while it does. Only "date" can be reopened: requests never open again once the
 * event has started, ended or been cancelled, and a draft opens by being published.
 */
export function requestsClosed(event: Pick<DomainEvent, "status" | "startsAt" | "endsAt" | "form">, now = new Date()): NonNullable<ApplicantsEvent["closed"]> | null {
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "ended" || now >= event.endsAt) return "ended";
  if (event.status === "draft") return "draft";
  if (now >= event.startsAt) return "started";
  return event.form.closes_at && now >= new Date(event.form.closes_at) ? "date" : null;
}
export function applicantsEvent(event: DomainEvent, approved: number): ApplicantsEvent {
  const closed = requestsClosed(event);
  return { id: event.id, editVersion: event.editVersion, capacity: event.capacity, approved, registration: closed ? "closed" : approved >= event.capacity ? "full" : "open",
    ...(closed ? { closed } : {}), ...(closed && event.form.closes_at ? { closedOn: fmt(event, new Date(event.form.closes_at), { weekday: "short", day: "numeric", month: "short" }).replace(",", "") } : {}), releaseOn: fmt(event, event.startsAt, { day: "numeric", month: "short" }), autoPromote: event.form.mode !== "request", requestLink: `${new URL(process.env.APP_URL ?? "http://localhost:3000").host}/e/${event.slug}` };
}
export function eventHeader(event: DomainEvent, views: RegistrationView[]): EventHeaderInfo {
  const approved = views.filter(v => v.registration.admission === "approved").length;
  return { id: event.id, editVersion: event.editVersion, name: event.name, status: adminStatus(event), when: `${fmt(event, event.startsAt, { dateStyle: "full", timeStyle: "short" })} · ${event.venue ?? ""}`, requestLink: applicantsEvent(event, approved).requestLink, guestCount: approved, requestCount: views.filter(v => v.registration.admission === "pending").length, mode: event.form.mode, registration: applicantsEvent(event, approved).registration };
}
/** Stored agenda → the page's rows: only well-formed {at,label} items (MCP and older writers may store anything). */
export function publicAgenda(stored: unknown): PublicEvent["agenda"] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap(item => {
    const o = (item ?? {}) as Record<string, unknown>;
    if (!(typeof o.at === "string" && Number.isFinite(Date.parse(o.at)) && typeof o.label === "string" && o.label.trim())) return [];
    const endAt = typeof o.endAt === "string" && Date.parse(o.endAt) > Date.parse(o.at) ? o.endAt : undefined;
    return [{ at: o.at, ...(endAt ? { endAt } : {}), label: o.label, ...(o.emphasis === true ? { emphasis: true } : {}) }];
  });
}
export function eventInput(input: EventInput) {
  if (!input.v2) throw new Error("Event model v2 fields are required");
  const v = input.v2;
  const mapped = { name: input.name, startsAt: localInstant(input.startsAtLocal, input.timezone), endsAt: localInstant(input.endsAtLocal, input.timezone), timezone: input.timezone, venue: input.venue, address: input.address, placeId: input.placeId, lat: input.lat, lng: input.lng, mapsUrl: input.mapsUrl, capacity: input.capacity, description: input.description,
    descriptionMd:v.descriptionMd, checks:v.checks, door:v.door,
    form:{...v.form,closes_at:v.closesAtLocal ? localInstant(v.closesAtLocal,input.timezone).toISOString() : null},
    emails:v.emails,cover:v.cover,speakers:v.speakers ?? [],
    // Agenda rows are wall-clock "HH:mm" (and optional "until") in the event's zone, on the event's date plus the row's
    // `day` / `untilDay` (kept from the stored item, so an after-midnight item stays on its date); an unchanged row keeps
    // its stored instants (a DST overlap time stays on the same side); editor-only ids are dropped.
    agenda:(v.agenda ?? []).map(r => { const date = input.startsAtLocal.slice(0, 10);
      return { at: agendaInstant(`${addDays(date, r.day ?? 0)}T${r.time}`, input.timezone, r.at),
        ...(r.until ? { endAt: agendaInstant(`${addDays(date, r.untilDay ?? r.day ?? 0)}T${r.until}`, input.timezone, r.endAt) } : {}), label: r.label.trim(), ...(r.emphasis ? { emphasis: true } : {}) }; }) };
  const parsed=eventCreateSchema.parse({...mapped,startsAt:mapped.startsAt.toISOString(),endsAt:mapped.endsAt.toISOString()});
  return {...parsed,startsAt:mapped.startsAt,endsAt:mapped.endsAt};
}

export async function publicModel(slug: string) { const model = await eventReadModel(slug); return model && model.event.status !== "draft" ? model : null; }
export async function publishedEvents() { return (await eventService.list()).filter(e => e.status !== "draft"); }

export const calendarSubscribers = () => identity.profile.subscriberCount();
