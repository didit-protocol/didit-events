import type { z } from "zod";
import type { Db } from "@didit-events/core/db";
import { Events } from "@didit-events/core/admission/events";
import { Admissions } from "@didit-events/core/admission/admission";
import { Invites } from "@didit-events/core/admission/invites";
import { eventReadModel, type RegistrationView } from "@didit-events/core/admission/read-model";
import { AdmissionError } from "@didit-events/core/admission/shared";
import { uploadEventCover } from "@didit-events/core/content/event-assets";
import { applicantDrawer } from "@didit-events/core/admission/applicants";
import { decodeEventCover } from "./images";
import { Door } from "@didit-events/core/door/service";
import { EventTeam } from "@didit-events/core/access/team";
import { can } from "@didit-events/core/access/capabilities";
import { createIdentityServices, IdentityError } from "@didit-events/core/identity";
import type { TokenPrincipal } from "@didit-events/core/identity/tokens";
import { getCalendarProfile, saveCalendarText, setCalendarImage, removeCalendarImage, validateCalendarImage, stripMetadata } from "@didit-events/core/calendar";
import { validateCalendarForm, toCalendarInput } from "../admin/calendar/validate";
import { BUILT_IN_COPY } from "../public/calendar-profile";
import { downloadImage } from "./images";
import { operationalDetail } from "@didit-events/core/status";
import { requeueFailedEmails } from "@didit-events/core/notifications/requeue";
import { schemas, toolCapabilities, type ToolName } from "./schemas";

export const readOnlyTools = new Set<ToolName>(["whoami", "events_list", "event_get", "applicants_list", "applicant_get", "guests_list", "event_team_list", "door_status", "calendar_get", "team_list", "system_status"]);
const view = (v: RegistrationView) => ({ registration: v.registration,
  account: { id: v.account.id, email: v.account.email, firstName: v.account.firstName, lastName: v.account.lastName, company: v.account.company, jobRole: v.account.jobRole },
  status: v.status, eligible: v.eligible, waitlistPosition: v.waitlistPosition, checkedIn: v.checkedIn, summary: v.summary });
const matches = (v: RegistrationView, search = "") => [v.account.email, v.account.firstName, v.account.lastName].join(" ").toLowerCase().includes(search.toLowerCase());

export function createTools(db?: Db) {
  const events = new Events(db), admissions = new Admissions(db), invites = new Invites(db), door = new Door({ db }), identity = createIdentityServices({ db }), team = new EventTeam(db);
  const handlers = new Map<ToolName, (input: unknown, actor: TokenPrincipal) => Promise<unknown>>();
  function add<N extends ToolName>(name: N, run: (input: z.infer<(typeof schemas)[N]>, actor: TokenPrincipal) => Promise<unknown>) {
    handlers.set(name, (input, actor) => run(schemas[name].parse(input) as z.infer<(typeof schemas)[N]>, actor));
  }
  async function model(eventId: string) { const model = await eventReadModel(eventId, db); if (!model) throw new AdmissionError("EventNotFound"); return model; }
  add("whoami", async (_input, actor) => ({ email: actor.email, role: actor.role, tokenName: actor.tokenName, expiresAt: actor.tokenExpiresAt }));
  add("events_list", async () => ({ items: await events.list() }));
  add("event_get", async ({ eventId }) => { const event = await events.get(eventId); if (!event) throw new AdmissionError("EventNotFound"); return event; });
  add("event_create", (input, actor) => events.create(actor, { ...input, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) }));
  add("event_update", ({ eventId, expectedVersion, patch: { startsAt, endsAt, ...patch } }, actor) => events.update(actor, eventId, { ...patch, expectedVersion,
    ...(startsAt !== undefined ? { startsAt: new Date(startsAt) } : {}),
    ...(endsAt !== undefined ? { endsAt: new Date(endsAt) } : {}),
  }));
  add("event_cover_set", async ({eventId,expectedVersion,alt,url,base64,variant},actor) => {
    const bytes = url ? await downloadImage(url) : decodeEventCover(base64!);
    const png = bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71;
    const jpeg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    if (!png && !jpeg) throw new AdmissionError("Use a PNG or JPEG image.");
    return uploadEventCover(actor,eventId,{expectedEventVersion:expectedVersion,alt,bytes,variant},db);
  });
  add("event_publish", ({ eventId }, actor) => events.publish(actor, eventId));
  add("event_cancel", async ({ eventId, reason }, actor) => { await events.cancel(actor, eventId, reason); return { cancelled: true }; });
  add("event_delete", async ({ eventId }, actor) => { await events.delete(actor, eventId, { draftOnly: true }); return { deleted: true }; });
  add("applicants_list", async ({ eventId, status, search }) => ({ items: (await model(eventId)).views.filter(v => (!status || v.registration.admission === status) && matches(v, search)).map(view) }));
  add("applicant_get", async ({ eventId, registrationId }, actor) => { const applicant = (await model(eventId)).views.find(v => v.registration.id === registrationId); if (!applicant) throw new AdmissionError("RegistrationNotFound"); return {...view(applicant),drawer:await applicantDrawer(actor,eventId,registrationId,db)}; });
  add("applicant_approve", ({ registrationId, ...options }, actor) => admissions.decide(actor, registrationId, "approved", { ...options, waitlistAtCapacity: false }));
  add("applicant_reject", ({ registrationId, reason, notify, block }, actor) => admissions.decide(actor, registrationId, "rejected", { reason, rejectEmail: notify, block }));
  add("applicant_waitlist", ({ registrationId }, actor) => admissions.transition(actor, registrationId, "waitlisted"));
  add("applicant_undo", async ({ registrationId }, actor) => { if (!await admissions.undoReject(actor, registrationId)) throw new AdmissionError("RejectionUndoUnavailable"); return { undone: true }; });
  add("invite_guests", ({ eventId, emails, ...options }, actor) => invites.batch(actor, eventId, emails, options));
  add("guests_list", async ({ eventId, search }) => ({ items: (await model(eventId)).views.filter(v => v.registration.admission === "approved" && matches(v, search)).map(view) }));
  add("guest_check_in", ({ registrationId, note }, actor) => door.manualCheckin(actor, registrationId, note || "Manual check-in"));
  add("guest_check_in_undo", async ({ checkinId, note }, actor) => { await door.undoCheckin(actor, checkinId, note || "Check-in undone"); return { undone: true }; });
  add("event_team_list", async ({ eventId }, actor) => ({ items: await team.list(actor, eventId) }));
  add("event_team_add", async ({ eventId, email, role }, actor) => team.add(actor, eventId, email, role));
  add("event_team_remove", async ({ eventId, memberId }, actor) => { await team.remove(actor, eventId, memberId); return { removed: true }; });
  add("door_status", async ({ eventId }, actor) => {
    const event = await events.get(eventId); if (!event) throw new AdmissionError("EventNotFound");
    const { sessions, pinSet } = await door.overview(actor, event.id), m = await model(event.id), today = new Date().toISOString().slice(0, 10);
    const scans = m.scans.filter(s => !s.test && s.createdAt.toISOString().slice(0, 10) === today);
    return { eventId: event.id, faceCheckin: event.door.kiosk, status: event.status, mode: event.door.kiosk ? event.door.mode : null, pinSet,
      doors: sessions.map(s => ({ station: s.station, startedBy: s.email, startedAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at })),
      scansToday: scans.length, checkedIn: m.checkins.filter(c => !c.undoneAt).length };
  });
  add("calendar_get", async () => await getCalendarProfile(db) ?? { ...BUILT_IN_COPY, websiteUrl: null, xUrl: null, linkedinUrl: null, coverVersion: 0, logoVersion: 0 });
  add("calendar_update", async (input, actor) => {
    const current = await getCalendarProfile(db), merged = { ...BUILT_IN_COPY, websiteUrl: null, xUrl: null, linkedinUrl: null, ...current, ...input };
    const form = { name: merged.name, tagline: merged.tagline, description: merged.description, websiteUrl: merged.websiteUrl ?? "", xUrl: merged.xUrl ?? "", linkedinUrl: merged.linkedinUrl ?? "" };
    const errors = validateCalendarForm(form);
    if (Object.keys(errors).length) throw new AdmissionError(Object.values(errors).join("; "));
    const images = [];
    // Download and validate every requested image before writing any part of the profile.
    for (const kind of ["cover", "logo"] as const) {
      const url = input[kind === "cover" ? "coverUrl" : "logoUrl"];
      if (url !== undefined) {
        const bytes = url === null ? null : await downloadImage(url);
        if (bytes) stripMetadata(bytes, validateCalendarImage(kind, bytes).type);
        images.push({ kind, bytes });
      }
    }
    await saveCalendarText(actor.email, toCalendarInput(form), db);
    for (const { kind, bytes } of images) {
      if (bytes) await setCalendarImage(actor.email, kind, bytes, merged, db);
      else await removeCalendarImage(actor.email, kind, db);
    }
    return getCalendarProfile(db);
  });
  add("team_list", async (_input, actor) => ({ items: await identity.team.listStaff(actor) }));
  add("team_invite", ({ email, role }, actor) => identity.auth.inviteStaff(actor, email, role));
  add("team_disable", async ({ email }, actor) => { if (email === actor.email) throw new IdentityError("CannotDisableSelf", 403); await identity.auth.disableStaff(actor, email); return { disabled: true }; });
  add("system_status", () => operationalDetail(db));
  add("outbox_requeue", (input, actor) => requeueFailedEmails(actor, input, db));
  return {
    async call(name: ToolName, input: unknown, actor: TokenPrincipal) {
      // One helper for every tool: the capability matrix (tokens belong to global staff).
      if (!can(actor.role, toolCapabilities[name])) throw new IdentityError(can("admin", toolCapabilities[name]) ? "OwnerOrAdminRequired" : can("owner", toolCapabilities[name]) ? "OwnerRequired" : "Forbidden", 403);
      return handlers.get(name)!(input, actor);
    },
  };
}
