/**
 * Who may do what: the single source of truth for admin authorization. Every admin page, server action, API route
 * and MCP tool names one capability; `requireEventAccess` (Events) and `requireEventActor` (core services) both
 * answer it from this table. Client-safe: no imports, so the admin UI can hide what the server would refuse.
 *
 * Global roles (the `staff` table, configured domains only) reach every event. Event roles (`event_members`) reach one event.
 */
export const GLOBAL_ROLES = ["owner", "admin", "staff"] as const;
export const EVENT_ROLES = ["host", "operator"] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];
export type EventRole = (typeof EVENT_ROLES)[number];
export type AccessRole = GlobalRole | EventRole;

const ALL = ["owner", "admin", "staff", "host", "operator"] as const satisfies readonly AccessRole[];
const MANAGERS = ["owner", "admin", "staff", "host"] as const satisfies readonly AccessRole[];
const STAFF = ["owner", "admin", "staff"] as const satisfies readonly AccessRole[];
const ADMINS = ["owner", "admin"] as const satisfies readonly AccessRole[];
const OWNERS = ["owner"] as const satisfies readonly AccessRole[];

/** Capabilities scoped to one event. */
export const EVENT_CAPABILITIES = {
  /** Overview tab, event header, live refresh. */
  "event.view": ALL,
  /** Full guest list and requests list (read-only), profile drawer without the selfie. */
  "guests.view": ALL,
  /** The guest's enrolled selfie in the profile drawer. */
  "guests.photo": MANAGERS,
  /** CSV export of the guest list. */
  "guests.export": MANAGERS,
  /** Approve, waitlist, reject, undo a rejection, notes, resend links, revoke a place. */
  "requests.decide": MANAGERS,
  /** Add guests, invite by email, CSV import, revoke invites. */
  "guests.invite": MANAGERS,
  /** Resolve an email mismatch on a guest's verification. */
  "guests.verification": MANAGERS,
  /** Check-in log. */
  "checkin.view": ALL,
  /** Manual check-in and undo. */
  "checkin.manual": ALL,
  /** Run the Door (kiosk mode) on this event, including Test mode. */
  "door.operate": ALL,
  /** See the event's door stations and end a door session remotely. */
  "door.manage": MANAGERS,
  /** Set or clear the PIN that ends door mode. */
  "door.pin": STAFF,
  /** Edit the event (details, form, checks, door, emails) and its settings, except the danger zone and spend limits. */
  "event.edit": MANAGERS,
  /** Event emails: preview and test sends. */
  "event.emails": MANAGERS,
  /** Publish a draft. */
  "event.publish": MANAGERS,
  /** Danger zone: end early, cancel. */
  "event.danger": STAFF,
  /** Delete the event. */
  "event.delete": ADMINS,
  /** A-18 scan/spend limits (door mode, strictness, daily scan budget). Over-capacity approvals stay owner/admin in core. */
  "event.limits": STAFF,
  /** See the event team. */
  "team.view": MANAGERS,
  /** Add, remove or re-invite event team members. */
  "team.manage": MANAGERS,
} as const satisfies Record<string, readonly AccessRole[]>;

/** Capabilities that are not about one event; event members never have them. */
export const GLOBAL_CAPABILITIES = {
  /** The events list (members see theirs; staff see all). Any admin user. */
  "admin.enter": ALL,
  "events.create": STAFF,
  /** Global staff team (A-12) and API tokens. */
  "staff.view": STAFF,
  "staff.manage": ADMINS,
  "tokens.manage": ADMINS,
  "calendar.view": STAFF,
  "calendar.edit": ADMINS,
  /** Directory-wide person search and address autocomplete used by the event editor. */
  "people.search": STAFF,
  /** People: every registered account, its registrations, attendance, verification and activity. Owners only. */
  "people.view": OWNERS,
  "places.search": MANAGERS,
  /** Recover a guest's face verification (owner/admin tool, any event). */
  "verifications.recover": ADMINS,
  /** Re-queue emails the provider refused (quota, rate limit, outage). Owners only. */
  "emails.requeue": OWNERS,
} as const satisfies Record<string, readonly AccessRole[]>;

export type EventCapability = keyof typeof EVENT_CAPABILITIES;
export type GlobalCapability = keyof typeof GLOBAL_CAPABILITIES;
export type Capability = EventCapability | GlobalCapability;

export const isEventCapability = (value: string): value is EventCapability => Object.hasOwn(EVENT_CAPABILITIES, value);
export const isGlobalCapability = (value: string): value is GlobalCapability => Object.hasOwn(GLOBAL_CAPABILITIES, value);
export const isEventRole = (value: unknown): value is EventRole => typeof value === "string" && (EVENT_ROLES as readonly string[]).includes(value);
export const isGlobalRole = (value: unknown): value is GlobalRole => typeof value === "string" && (GLOBAL_ROLES as readonly string[]).includes(value);

/** True when `role` holds `capability`. Unknown roles and capabilities are refused. */
export function can(role: AccessRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  const roles: readonly AccessRole[] | undefined = isEventCapability(capability) ? EVENT_CAPABILITIES[capability] : isGlobalCapability(capability) ? GLOBAL_CAPABILITIES[capability] : undefined;
  return !!roles && roles.includes(role);
}

/** Every capability a role holds (UI hints; the server re-checks each one). */
export function capabilitiesOf(role: AccessRole): Capability[] {
  return ([...Object.keys(EVENT_CAPABILITIES), ...Object.keys(GLOBAL_CAPABILITIES)] as Capability[]).filter(c => can(role, c));
}

/** Plain-words role descriptions for the event Team tab. */
export const EVENT_ROLE_SUMMARY: Record<EventRole, string> = {
  host: "Runs this event: guests, requests, invites, settings, emails, check-in and the door. Can’t cancel or delete it.",
  operator: "Works the door: sees the guest list and check-in log, checks guests in by hand and runs the Door.",
};
