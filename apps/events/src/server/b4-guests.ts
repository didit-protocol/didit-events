import type { RegistrationView } from "@didit-events/core/admission/read-model";
import type { ApplicantDrawer } from "@didit-events/core/contracts/event-model";
import type { GuestDetail, GuestRow } from "../admin/guests/types";
import { diditSessionUrl, displayName, personSummary, personView, type PersonAccess, type PersonModel } from "./b4-person";

/** "19:42" in the event's zone. */
const doorTime = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);

export function guestRow(v: RegistrationView, model: Pick<PersonModel, "event">, now = new Date(), access: PersonAccess = { photos: false }): GuestRow {
  const a = v.account, r = v.registration, event = model.event;
  const status: GuestRow["status"] = v.checkedIn ? "checked-in" : r.admission !== "approved" ? "revoked" : v.eligible ? "verified" : v.status.status === "in_review" || v.status.status === "requirements_unmet" ? "in-review" : v.status.status === "declined" ? "declined" : v.status.status === "verifying" ? "verifying" : "link-sent";
  // "Not checked in" only once doors are open (the event started); before that the column stays empty.
  const checkedIn: GuestRow["checkedIn"] = v.checkedIn ? { kind: "time", time: doorTime(v.checkedIn.checkedInAt, event.timezone) } : v.eligible && r.admission === "approved" && now >= event.startsAt ? { kind: "missing" } : { kind: "none" };
  return { id: r.id, name: displayName(v), person: { ...personSummary(event.id, v, now, access), timeZone: event.timezone }, email: a.email, emailVerified: !!a.emailVerifiedAt, status, verification: v.status.label, checkedIn, source: r.application.source === "CSV" ? "CSV" : r.application.source === "staff" ? "Added by staff" : "Request form", verifyUrl: "", diditUrl: v.verification ? diditSessionUrl(v.verification.diditSessionId) : undefined };
}

/** A-06 drawer: the row's status and callouts, plus the shared person view (`drawer` null → retained data expired). */
export function guestDetail(model: PersonModel, v: RegistrationView, drawer: ApplicantDrawer | null, access: PersonAccess, now = new Date()): GuestDetail {
  const row = guestRow(v, model, now, access), verification = v.verification;
  const state: GuestDetail["verification"]["state"] = v.eligible ? "approved" : verification?.status === "in_review" ? "in-review" : verification?.status === "declined" ? "declined" : verification?.status === "started" ? "in-progress" : "not-started";
  const mismatch = verification?.emailMatches === false && verification.verifiedEmail && verification.acceptedEmail !== verification.verifiedEmail ? { invited: row.email, verified: verification.verifiedEmail } : undefined;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    verification: { session: verification?.diditSessionId ?? "", state: mismatch ? "email-mismatch" : state },
    invite: { sent: "", url: "", display: "" },
    ...(state === "declined" && verification?.policyReason ? { declineReason: verification.policyReason } : {}),
    ...(mismatch ? { mismatch } : {}),
    person: personView(model, v, drawer, access, now),
  };
}
