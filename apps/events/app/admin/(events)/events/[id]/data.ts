import { getDb,queryable,type DomainEvent } from "@didit-events/core";
import type { EventHeaderInfo, EventTab } from "../../../../../src/admin/types";
import { can, type EventCapability } from "@didit-events/core/access/capabilities";
import { roleOn } from "@didit-events/core/access/principal";
import { eventAccess, findEventAccess } from "../../../../../src/auth/access";

/** Both URL slugs and stored UUIDs resolve here; an arbitrary URL segment is never cast to uuid. */
export async function getEvent(idOrSlug: string): Promise<DomainEvent | null> {
  return (await findEventAccess(idOrSlug, "event.view"))?.event ?? null;
}

export async function resolveEventId(idOrSlug: string): Promise<string | null> {
  return (await findEventAccess(idOrSlug, "event.view"))?.event.id ?? null;
}

/**
 * Resolve at each page boundary: streamed tabs may execute without their parent layout. One access check returns the
 * event it resolved (sign-in, forbidden and not-found exactly as `requireEventAccess`), instead of three lookups in a row.
 */
export async function requireEvent(idOrSlug: string): Promise<DomainEvent> {
  return (await eventAccess(idOrSlug, "event.view")).event;
}

/** Which tabs each capability opens (the server re-checks on every page). */
const TAB_CAPABILITY: Record<EventTab, EventCapability> = { overview: "event.view", guests: "guests.view", applicants: "guests.view", log: "checkin.view", door: "door.operate", team: "team.view", settings: "event.edit" };
export async function getEventHeader(idOrSlug: string): Promise<EventHeaderInfo | null> {
  const access = await findEventAccess(idOrSlug, "event.view");
  if (!access) return null;
  const { event, viewer } = access;
  const role = roleOn(viewer, event.id);
  const [counts] = await queryable(getDb()).query<{ guests: number; requests: number }>(`select
    count(*) filter (where admission='approved')::int as guests,
    count(*) filter (where admission='pending')::int as requests from registrations where event_id=$1`, [event.id]);
  const now = new Date();
  const status = event.status === "cancelled" ? "cancelled" : event.status === "ended" || event.endsAt <= now ? "ended"
    : event.status === "draft" ? "draft" : event.startsAt <= now ? "live" : "open";
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: event.timezone, weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: event.timezone, hour: "2-digit", minute: "2-digit", hour12: false });
  const publicUrl = new URL(`/e/${encodeURIComponent(event.slug)}`, process.env.APP_URL ?? "https://events.didit.me");
  return {
    id: event.slug, name: event.name, status,
    mode: event.form.mode,
    registration: event.status !== "published" || event.startsAt <= now || (event.form.closes_at && new Date(event.form.closes_at!) <= now)
      ? "closed" : counts!.guests >= event.capacity ? "full" : "open",
    when: [`${date.format(event.startsAt)} · ${time.format(event.startsAt)}–${time.format(event.endsAt)}`, event.venue, event.address].filter(Boolean).join(" · "),
    requestLink: publicUrl.host + publicUrl.pathname, publicUrl: publicUrl.href, guestCount: counts!.guests, requestCount: counts!.requests,
    editVersion: event.editVersion,
    role: role ?? undefined, // A cancelled event has no door to open: the tab goes with the header's "Open door".
    tabs: (Object.keys(TAB_CAPABILITY) as EventTab[]).filter(t => can(role, TAB_CAPABILITY[t]) && !(t === "door" && status === "cancelled")),
  };
}

/** The event's IANA time zone (plan §2 `events.tz`); every admin time on the event's pages is shown in it. */
export async function getEventTimeZone(id: string): Promise<string> {
  return (await eventAccess(id, "event.view")).event.timezone;
}
