import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { admissionService } from "@didit-events/core";
import { applicantSelfie } from "@didit-events/core/admission/applicants";
import { queryable } from "@didit-events/core/db/tx";
import { auth, databaseSuite } from "../testing/b4";
import { getGuestDetail, listGuests } from "../../app/admin/(events)/events/[id]/(tabs)/guests/data";
import { getApplicantDetail, listApplicants, reopenRequests } from "../../app/admin/(events)/events/[id]/(tabs)/applicants/data";
import { ApplicantDrawer } from "../admin/applicants/ApplicantDrawer";
import { eventService } from "@didit-events/core";
import { GuestDrawer } from "../admin/guests/GuestDrawer";
import { checkedInLabel, parseGuestQuery } from "../admin/guests/query";
import { parseApplicantQuery } from "../admin/applicants/query";
import { fmtWhen } from "../admin/person/format";
import { guestDetail, guestRow } from "./b4-guests";
import { adminModel, applicantRow } from "./b4-views";

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("NEXT_REDIRECT;" + url); }, useRouter: () => ({ push() {}, refresh() {}, replace() {} }) }));

const state = databaseSuite();
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const EMAIL_AT = "2026-02-12T10:04:00.000Z", CREATED_AT = "2026-02-10T09:00:00.000Z", FACE_AT = "2026-03-30T08:15:00.000Z";

/** A guest with every field filled: profile, photo, verified email, approved selfie, consent, approval, face check-in. */
async function fullGuest() {
  const q = queryable(state.db), id = state.registrationId;
  await q.query(
    `update accounts set headline='Head of Risk', company='Globex', job_role='Fraud & Identity', bio='Building fraud tooling for mobility.',
     profile_links=$2::jsonb, photo=$3, email_verified_at=$4, created_at=$5 where id=$1`,
    [state.accountId, JSON.stringify([{ kind: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/in/test-guest" }, { kind: "other", label: "X", href: "https://x.com/testguest" }]), Buffer.from([0xff, 0xd8, 0xff, 0xd9]), EMAIL_AT, CREATED_AT],
  );
  await admissionService.transition(auth.staff!, id, "approved");
  // The fixture's face proof is a legacy one (bindings are immutable): replace it with an approved selfie liveness.
  const [proof] = await q.query<{ verification_id: string }>("delete from evidence where account_id=$1 and kind='face' returning verification_id", [state.accountId]);
  await q.query("insert into evidence(account_id,verification_id,kind,source,established_at,valid_until,activation,provider_status) values($1,$2,'face','liveness',$3,clock_timestamp()+interval '170 days','active','approved')", [state.accountId, proof!.verification_id, FACE_AT]);
  const [kiosk] = await q.query<{ id: string }>("insert into kiosks(event_id,name) values($1,'Main door') returning id", [state.eventId]);
  await q.query("insert into checkins(event_id,registration_id,kiosk_id,method,similarity,checked_in_at) values($1,$2,$3,'face',96.4,clock_timestamp())", [state.eventId, id, kiosk!.id]);
  const [v] = await q.query<{ session: string }>("select didit_session_id::text session from verifications where account_id=$1", [state.accountId]);
  return { id, session: v!.session };
}

it("guest drawer: every rendered field comes from the account, evidence, registration, history and check-in", async () => {
  const { id, session } = await fullGuest();
  const detail = (await getGuestDetail(state.eventId, id))!;
  const p = detail.person, tz = p.timeZone;
  expect(p).toMatchObject({ name: "Test Guest", headline: "Head of Risk", company: "Globex", role: "Fraud & Identity", emailVerifiedAt: EMAIL_AT, createdAt: CREATED_AT });
  expect(p.photoUrl).toMatch(new RegExp(`^/api/admin/events/${state.eventId}/applicants/${id}/photo\\?v=\\d+$`));
  expect(p.verified).toMatchObject({ verifiedAt: FACE_AT, method: "Selfie liveness", emailVerifiedAt: EMAIL_AT, createdAt: CREATED_AT });
  expect(p.verification).toMatchObject({ state: "verified", sessionId: session, diditUrl: `https://business.didit.me/verification/sessions/${session}`, selfieUrl: `/api/admin/events/${state.eventId}/applicants/${id}/selfie` });
  expect(p.request.consent).toMatchObject({ checks: ["Human / face"], eventConsent: true });
  expect(p.checkIn).toMatchObject({ door: "Main door", match: 96 });
  expect(p.timeline.slice(0, 4).map((t) => [t.label, t.done])).toEqual([["Requested", true], ["Approved", true], ["Verified", true], ["Checked in", true]]);
  expect(p.timeline[1]!.who).toBe(auth.staff!.email);

  const html = decode(renderToStaticMarkup(<GuestDrawer eventId={state.eventId} detail={detail} closeHref="/x" inline />));
  for (const text of [
    `src="${p.photoUrl}"`,
    "Test Guest",
    `Verified by Didit · ${fmtWhen(FACE_AT, tz)}`,
    `Email verified ${fmtWhen(EMAIL_AT, tz)}`,
    `Profile created ${fmtWhen(CREATED_AT, tz)}`,
    "Head of Risk — Fraud & Identity · Globex",
    "Building fraud tooling for mobility.",
    'href="https://www.linkedin.com/in/test-guest"',
    ">X<",
    `Verified ${fmtWhen(EMAIL_AT, tz)}`,
    "Selfie liveness",
    fmtWhen(FACE_AT, tz, true),
    `<code>${session}</code>`,
    "Open in Didit ↗",
    "Show selfie",
    `Accepted ${fmtWhen(p.request.consent!.acceptedAt, tz, true)} · profile shared with hosts · checks: Human / face`,
    fmtWhen(p.request.requestedAt, tz, true),
    "Main door",
    "96% match",
    fmtWhen(p.checkIn!.at, tz, true),
  ]) expect(html).toContain(text);
  for (const wrong of ["Not verified yet", "Not answered yet", "Not on profile", ">Pending<", "Date —"]) expect(html).not.toContain(wrong);

  // The table row: photo, badge, the door time in the event's zone.
  const list = (await listGuests(state.eventId, parseGuestQuery({})))!;
  const row = list.page.rows.find((r) => r.id === id)!;
  expect(row.person).toMatchObject({ photoUrl: p.photoUrl, verified: { verifiedAt: FACE_AT }, timeZone: tz });
  expect(row.checkedIn).toEqual({ kind: "time", time: expect.stringMatching(/^\d{2}:\d{2}$/) });

  // The Requests drawer shows the same person.
  const applicant = (await getApplicantDetail(state.eventId, id, parseApplicantQuery({})))!;
  expect(applicant.detail.person).toMatchObject({ name: "Test Guest", verified: { verifiedAt: FACE_AT }, photoUrl: p.photoUrl, company: "Globex" });
  expect(applicant.row.person?.verified?.verifiedAt).toBe(FACE_AT);
});

it("checked-in column: — before doors open, Not checked in after; never Missing", async () => {
  const id = state.registrationId;
  await admissionService.transition(auth.staff!, id, "approved");
  const before = (await listGuests(state.eventId, parseGuestQuery({})))!.page.rows.find((r) => r.id === id)!;
  expect(before.status).toBe("verified");
  expect(checkedInLabel(before.checkedIn)).toBe("—");
  await queryable(state.db).query("update events set starts_at=clock_timestamp()-interval '1 hour' where id=$1", [state.eventId]);
  const after = (await listGuests(state.eventId, parseGuestQuery({})))!.page.rows.find((r) => r.id === id)!;
  expect(checkedInLabel(after.checkedIn)).toBe("Not checked in");
  const detail = (await getGuestDetail(state.eventId, id))!;
  expect(decode(renderToStaticMarkup(<GuestDrawer eventId={state.eventId} detail={detail} closeHref="/x" inline />))).toContain("Not checked in");
});

it("without the drawer DTO (retained data expired) the account facts still show", async () => {
  const { id } = await fullGuest();
  const model = (await adminModel(state.eventId))!, view = model.views.find((v) => v.registration.id === id)!;
  const p = guestDetail(model, view, null, { photos: true }).person;
  expect(p).toMatchObject({ company: "Globex", role: "Fraud & Identity", headline: "Head of Risk", emailVerifiedAt: EMAIL_AT });
  expect(p.links.map((l) => l.kind)).toEqual(["LinkedIn", "X"]);
  expect(p.timeline.find((t) => t.key === "approved")?.done).toBe(true);
});

it("without guests.photo (door operators) the person view and table rows carry no photo or selfie", async () => {
  const { id } = await fullGuest();
  const model = (await adminModel(state.eventId))!, view = model.views.find((v) => v.registration.id === id)!;
  const allowed = guestDetail(model, view, null, { photos: true }), denied = guestDetail(model, view, null, { photos: false });
  expect(allowed.person.photoUrl).toMatch(/\/photo\?v=\d+$/); expect(allowed.person.verification.selfieUrl).toMatch(/\/selfie$/);
  expect(denied.person.photoUrl).toBeNull(); expect(denied.person.verification.selfieUrl).toBeNull();
  expect(denied.person.verified).toMatchObject({ verifiedAt: FACE_AT }); // the badge is not a photo
  expect(guestRow(view, model, new Date(), { photos: false }).person?.photoUrl).toBeUndefined();
  expect(applicantRow(view, model.event, new Date(), { photos: false }).person?.photoUrl).toBeUndefined();
  expect(applicantRow(view, model.event).person?.photoUrl).toBeUndefined(); // rows default to no photo
  const html = decode(renderToStaticMarkup(<GuestDrawer eventId={state.eventId} detail={denied} closeHref="/x" inline />));
  expect(html).not.toContain("Show selfie"); expect(html).not.toContain("/photo?v=");
});

it("a phone shows Verified only with an active proof of exactly that number", async () => {
  const { id } = await fullGuest();
  const model = (await adminModel(state.eventId))!, base = model.views.find((v) => v.registration.id === id)!;
  const at = new Date("2026-03-01T10:00:00Z"), until = new Date(Date.now() + 86400_000);
  const proof = (e164: string, extra: Record<string, unknown> = {}) => ({ ...base.evidence[0]!, id: crypto.randomUUID(), kind: "phone", source: "phone", binding: "account", value: { e164 }, providerStatus: "approved", activation: "active", invalidatedAt: null, establishedAt: at, validUntil: until, ...extra });
  const withPhone = (evidence: unknown[]) => ({ ...base, evidence: [...base.evidence, ...evidence], registration: { ...base.registration, applicationV2: { ...base.registration.applicationV2!, fields: { ...base.registration.applicationV2?.fields, phone_number: "+34 612 34 56 78" } } } }) as typeof base;
  const phone = (evidence: unknown[]) => guestDetail(model, withPhone(evidence), null, { photos: true }).person.request.extras.find((x) => x.label === "Phone");
  expect(phone([proof("+34612345678")])).toMatchObject({ value: "+34 612 34 56 78", verified: true, verifiedAt: at.toISOString() });
  expect(phone([proof("+34699999999")])).toMatchObject({ verified: false, verifiedAt: null }); // another number
  expect(phone([proof("+34612345678", { activation: "pending_continuity" })])).toMatchObject({ verified: false });
  expect(phone([proof("+34612345678", { invalidatedAt: new Date() })])).toMatchObject({ verified: false });
  expect(phone([proof("+34612345678", { validUntil: new Date(Date.now() - 1000) })])).toMatchObject({ verified: false });
  expect(phone([proof("+34612345678", { providerStatus: "declined" })])).toMatchObject({ verified: false });
});

it("selfie: staff-only, from the face proof's Didit decision, private no-store", async () => {
  const { id, session } = await fullGuest();
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const getDecision = vi.fn(async () => ({ liveness_checks: [{ status: "Approved", reference_image: "https://media.didit.me/selfie.jpg" }] }) as never);
  const fetchImpl = vi.fn(async (_url: string) => new Response(bytes, { headers: { "content-type": "image/jpeg" } }));
  const res = await applicantSelfie(auth.staff!, state.eventId, id, { client: { getDecision }, fetch: fetchImpl as unknown as typeof fetch }, state.db);
  expect(getDecision).toHaveBeenCalledWith(session);
  expect(fetchImpl.mock.calls[0]![0]).toBe("https://media.didit.me/selfie.jpg");
  expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(res.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  const insecure = vi.fn(async () => ({ liveness_checks: [{ status: "Approved", reference_image: "http://media.didit.me/selfie.jpg" }] }) as never);
  await expect(applicantSelfie(auth.staff!, state.eventId, id, { client: { getDecision: insecure }, fetch: fetchImpl as unknown as typeof fetch }, state.db)).rejects.toMatchObject({ code: "not_found" });
  const html = vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
  await expect(applicantSelfie(auth.staff!, state.eventId, id, { client: { getDecision }, fetch: html as unknown as typeof fetch }, state.db)).rejects.toMatchObject({ code: "provider_unavailable" });
  await expect(applicantSelfie(auth.staff!, state.otherId, id, { client: { getDecision }, fetch: fetchImpl as unknown as typeof fetch }, state.db)).rejects.toMatchObject({ code: "not_found" });
});

it("an account being deleted: the applicant drawer loads a minimal “Account deleted” view, with the decisions and no photo", async () => {
  const { id } = await fullGuest();
  const q = queryable(state.db);
  await admissionService.transition(auth.staff!, id, "cancelled_by_host", "Removed by staff");
  await q.query("update accounts set deleting_at=clock_timestamp() where id=$1", [state.accountId]);
  // The list: no photo URL, so the browser never asks the photo route (it answers 404 for this account).
  const list = (await listApplicants(state.eventId, parseApplicantQuery({ tab: "cancelled" })))!;
  const listed = list.rows.find((r) => r.id === id)!;
  expect(listed).toBeDefined();
  expect(listed.person?.photoUrl).toBeUndefined();
  // The drawer: it loads (it used to throw AccountUnavailable → "Couldn't load this applicant").
  const applicant = (await getApplicantDetail(state.eventId, id, parseApplicantQuery({ tab: "cancelled" })))!;
  expect(applicant.detail.v2).toMatchObject({ accountDeleted: true, badges: [], answers: [], profile: { photoUrl: null, fullName: "", company: "" }, actions: { approve: false, reject: false, revoke: false } });
  expect(applicant.detail.v2!.history.some((h) => h.kind === "admission")).toBe(true);
  const person = applicant.detail.person!;
  expect(person).toMatchObject({ accountDeleted: true, photoUrl: null, company: "", headline: "", bio: "", links: [], verified: null });
  expect(person.email).toBe("");
  expect(person.verification.selfieUrl).toBeNull();
  expect(person.timeline.length).toBeGreaterThan(0);
  const html = decode(renderToStaticMarkup(<ApplicantDrawer eventId={state.eventId} detail={applicant.detail} row={applicant.row} event={list.event} index={applicant.index} total={applicant.total} closeHref="/x" inline />));
  expect(html).toContain("Account deleted");
  const guestEmail = (await q.query<{ email: string }>("select a.email from registrations r join accounts a on a.id=r.account_id where r.id=$1", [id]))[0]?.email;
  if (guestEmail) expect(html).not.toContain(guestEmail);
  expect(html).toContain("This person deleted their account.");
  expect(html).toContain("Timeline");
  for (const gone of ["Couldn’t load this applicant", "/photo", "/selfie", "Show selfie", "Globex", "Head of Risk", "Didit session"]) expect(html).not.toContain(gone);
});

it("“Reopen requests”: a passed closing date reopens and persists; a started event is refused and says why", async () => {
  const q = queryable(state.db);
  // Closing date passed, the event is still ahead: closed with its date, and reopening sticks.
  await q.query("update events set form=jsonb_set(form,'{closes_at}',$2::jsonb) where id=$1", [state.eventId, JSON.stringify(new Date(Date.now() - 3600_000).toISOString())]);
  let list = (await listApplicants(state.eventId, parseApplicantQuery({})))!;
  expect(list.event).toMatchObject({ registration: "closed", closed: "date" });
  expect(list.event.closedOn).toMatch(/^\w{3} \d{1,2} \w{3}$/);
  expect(await reopenRequests(state.eventId, (await eventService.get(state.eventId))!.editVersion)).toBe(true);
  list = (await listApplicants(state.eventId, parseApplicantQuery({})))!;
  expect(list.event.registration).not.toBe("closed");
  expect(list.event.closed).toBeUndefined();
  expect((await eventService.get(state.eventId))!.form.closes_at).toBeNull();
  // Started, no closing date: closed because it started. No empty date, and reopening is refused instead of "reopened".
  await q.query("update events set starts_at=now()-interval '1 hour' where id=$1", [state.eventId]);
  list = (await listApplicants(state.eventId, parseApplicantQuery({})))!;
  expect(list.event).toMatchObject({ registration: "closed", closed: "started" });
  expect(list.event.closedOn).toBeUndefined();
  const before = (await eventService.get(state.eventId))!.editVersion;
  expect(await reopenRequests(state.eventId, before)).toBe("closed");
  expect((await eventService.get(state.eventId))!.editVersion).toBe(before);
});

it("a cancelled future event: CANCELLED in the list and the overview, with the reason; never ENDED", async () => {
  const { adminStatus } = await import("./b4-views");
  const { overview } = await import("./b4-overview");
  const event = (await eventService.get(state.eventId))!;
  await eventService.cancel(auth.staff!, state.eventId, "Venue flooded", event.editVersion);
  const model = (await adminModel(state.eventId))!;
  expect(model.event.startsAt.getTime()).toBeGreaterThan(Date.now());
  expect(adminStatus(model.event)).toBe("cancelled");
  expect(model.cancelReason).toBe("Venue flooded");
  expect(overview(model)).toMatchObject({ status: "cancelled", cancelReason: "Venue flooded" });
  expect((await listApplicants(state.eventId, parseApplicantQuery({})))!.event).toMatchObject({ registration: "closed", closed: "cancelled" });
});
