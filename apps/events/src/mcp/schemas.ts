import { z } from "zod";
import { can, type Capability } from "@didit-events/core/access/capabilities";
import { isStaffEmail } from "@didit-events/core/staff-email";
import { REQUEUE_CODES, REQUEUE_DEFAULT_HOURS, REQUEUE_MAX_HOURS } from "@didit-events/core/notifications/requeue";
import { agendaSchema, checksSchema, doorSchema, formSchema, emailsSchema, coverSchema, speakersSchema } from "@didit-events/core/domain/event-model";

const id = z.uuid(), text = z.string().trim().min(1), reason = text.max(500);
const date = z.iso.datetime({ offset: true });
const https = z.url({ protocol: /^https$/ }).max(2048);
const eventFields = {
  slug: text.max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: text.max(200),
  description: z.string().max(600).optional(), startsAt: date, endsAt: date,
  timezone: text.max(100).optional(), venue: z.string().max(300).nullable().optional(), address: z.string().max(500).nullable().optional(),
  capacity: z.number().int().positive().max(1000000),
  descriptionMd: z.string().max(20000).optional(), checks: checksSchema.optional(), door: doorSchema.optional(),
  form: formSchema.optional(), emails: emailsSchema.optional(), cover: coverSchema.optional(), speakers: speakersSchema.optional(), agenda: agendaSchema.optional(),
  placeId: z.string().max(300).nullable().optional(), lat: z.number().min(-90).max(90).nullable().optional(), lng: z.number().min(-180).max(180).nullable().optional(),
  mapsUrl: https.max(500).nullable().optional(),
};
const empty = z.strictObject({}), eventId = z.strictObject({ eventId: id }), registrationId = z.strictObject({ registrationId: id });
const search = { search: z.string().max(200).optional() };
const status = z.enum(["pending", "approved", "waitlisted", "rejected", "cancelled_by_guest", "cancelled_by_host", "revoked"]);
// Same rule as the Team page: STAFF_EMAIL_DOMAIN (comma-separated), read per call.
const staffEmail = z.email().max(254).refine(email => isStaffEmail(email), "Use an address on the configured staff email domain");
export const schemas = {
  whoami: empty,
  events_list: empty,
  event_get: z.strictObject({ eventId: text.max(160) }),
  event_create: z.strictObject(eventFields),
  event_update: z.strictObject({ eventId: id, expectedVersion: z.number().int().positive(), patch: z.strictObject(eventFields).partial() }),
  event_cover_set: eventId.extend({ expectedVersion:z.number().int().positive(), alt:text.max(200), url:https.optional(), base64:z.string().max(7*1024*1024).optional(), variant:z.enum(["main","wide"]).optional() }).refine(v=>Boolean(v.url)!==Boolean(v.base64), "Provide exactly one of url or base64"),
  event_publish: eventId,
  event_cancel: eventId.extend({ reason }),
  event_delete: eventId,
  applicants_list: eventId.extend({ status: status.optional(), ...search }),
  applicant_get: eventId.extend({ registrationId: id }),
  applicant_approve: registrationId.extend({ overCapacity: z.boolean().optional(), notify: z.boolean().optional() }),
  applicant_reject: registrationId.extend({ reason, notify: z.boolean().optional(), block: z.boolean().optional() }),
  applicant_waitlist: registrationId,
  applicant_undo: registrationId,
  invite_guests: eventId.extend({ emails: z.array(z.email().max(254)).min(1).max(100), message: z.string().max(500).optional(), skipApproval: z.boolean().default(false), sendLink: z.boolean().optional() }),
  guests_list: eventId.extend(search),
  guest_check_in: registrationId.extend({ note: z.string().trim().max(280).default("") }),
  guest_check_in_undo: z.strictObject({ checkinId: id, note: z.string().trim().max(280).default("") }),
  event_team_list: eventId,
  event_team_add: eventId.extend({ email: z.email().max(254), role: z.enum(["host", "operator"]) }),
  event_team_remove: eventId.extend({ memberId: id }),
  door_status: eventId,
  calendar_get: empty,
  calendar_update: z.strictObject({
    name: text.max(80).optional(), tagline: z.string().max(120).optional(), description: z.string().max(600).optional(),
    websiteUrl: https.max(300).nullable().optional(), xUrl: https.max(300).nullable().optional(), linkedinUrl: https.max(300).nullable().optional(),
    coverUrl: https.nullable().optional(), logoUrl: https.nullable().optional(),
  }),
  team_list: empty,
  team_invite: z.strictObject({ email: staffEmail, role: z.enum(["owner", "admin", "staff"]).default("staff") }),
  team_disable: z.strictObject({ email: staffEmail }),
  system_status: empty,
  outbox_requeue: z.strictObject({ hours: z.number().int().min(1).max(REQUEUE_MAX_HOURS).default(REQUEUE_DEFAULT_HOURS), codes: z.array(z.enum(REQUEUE_CODES)).min(1).max(REQUEUE_CODES.length).optional(), dryRun: z.boolean().default(false) }),
} as const;
export type ToolName = keyof typeof schemas;
/**
 * The capability each tool needs (single source: @didit-events/core/access/capabilities). MCP callers are staff API
 * tokens, so the global role answers; core services re-check inside their transactions.
 */
export const toolCapabilities: Record<ToolName, Capability> = {
  whoami: "admin.enter", events_list: "admin.enter", event_get: "event.view", event_create: "events.create", event_update: "event.edit",
  event_cover_set: "event.edit", event_publish: "event.publish", event_cancel: "event.danger", event_delete: "event.delete",
  applicants_list: "guests.view", applicant_get: "guests.view", applicant_approve: "requests.decide", applicant_reject: "requests.decide",
  applicant_waitlist: "requests.decide", applicant_undo: "requests.decide", invite_guests: "guests.invite", guests_list: "guests.view",
  guest_check_in: "checkin.manual", guest_check_in_undo: "checkin.manual",
  event_team_list: "team.view", event_team_add: "team.manage", event_team_remove: "team.manage", door_status: "door.operate",
  calendar_get: "calendar.view", calendar_update: "calendar.edit", team_list: "staff.manage", team_invite: "staff.manage", team_disable: "staff.manage",
  system_status: "staff.manage", outbox_requeue: "emails.requeue",
};
/** Tools only owners and admins hold (derived from the matrix). */
export const managerTools: readonly ToolName[] = (Object.keys(toolCapabilities) as ToolName[]).filter(name => !can("staff", toolCapabilities[name]));
export const descriptions: Record<ToolName, string> = {
  whoami: "Current staff email, role, token name and expiry.", events_list: "List admin events, including drafts.", event_get: "Get an event by ID or slug.",
  event_create: "Create a draft event. Dates must include a UTC offset.", event_update: "Update event fields; use lifecycle tools to publish or cancel.",
  event_cover_set: "Store an event cover from a public HTTPS URL or base64 PNG/JPEG (up to 5 MB). variant \"main\" (default, square page cover) or \"wide\" (banner, about 10:3, used by tickets, cards and email heroes). Uses the current edit version and preserves guest-list privacy.",
  event_publish: "Publish a future draft event.", event_cancel: "Cancel an event with a reason and notify affected guests.", event_delete: "Permanently delete a draft event (owner/admin only).",
  applicants_list: "List applicants filtered by admission status and name or email search.", applicant_get: "Get an applicant in an event.",
  applicant_approve: "Approve an applicant; over-capacity approval requires owner/admin.", applicant_reject: "Reject with a reason; notification defaults to enabled.",
  applicant_waitlist: "Move an applicant to the waitlist.", applicant_undo: "Undo a rejection within the service's 30-second window.",
  invite_guests: "Invite up to 100 emails using the admin invitation service.", guests_list: "List approved guests and their check-in status.",
  guest_check_in: "Manually check in an approved guest at a live event, with an optional note.", guest_check_in_undo: "Undo a check-in using its checkinId.",
  event_team_list: "List an event's team (hosts and door operators).", event_team_add: "Add someone to an event's team by email, or change their role; emails the invitation.",
  event_team_remove: "Remove someone from an event's team; their access and any door they started end now.",
  door_status: "Door status for an event: whether face check-in is on and live, doors running now (station, who started it, last seen), today's scans and check-ins.",
  calendar_get: "Get the calendar profile and image versions.", calendar_update: "Update calendar text/links or download HTTPS cover/logo images (5 MB maximum); null removes an image. Owner/admin only.",
  team_list: "List staff (owner/admin only).", team_invite: "Invite staff or change a role; only owners can grant owner.", team_disable: "Disable a staff member; owner protections apply.",
  system_status: "Why the admin shows \"Didit is not responding\": stuck webhooks, the reconcile job and stuck verification sends, plus `emails`: pending (retrying or due) and failed (last 24 h) email sends by error code, e.g. provider_quota (counts, kinds, error codes; owner/admin only).",
  outbox_requeue: "Re-queue emails that failed with a retryable provider error (provider_quota, retries_exhausted, resend_429, resend_5xx, resend_network) in the last N hours (default 48, max 168), optionally only some codes. Never re-sends an email that was sent, suppressed by our rules or rejected for good. Returns counts per error code and email kind; dryRun only counts. Owner only.",
};

/** Generated directly from the validator, so the wire schema has the same required/defaulted fields. */
export function toolDefinitions() {
  return (Object.keys(schemas) as ToolName[]).map(name => ({ name, description: descriptions[name], inputSchema: z.toJSONSchema(schemas[name], { io: "input" }) }));
}
