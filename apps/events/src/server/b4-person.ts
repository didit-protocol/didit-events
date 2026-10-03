import type { DomainEvent } from "@didit-events/core";
import type { RegistrationView } from "@didit-events/core/admission/read-model";
import type { ApplicantDrawer } from "@didit-events/core/contracts/event-model";
import { checkLabel, linkKind, personFromDrawer, personTimeline } from "../admin/person/build";
import type { PersonCheckIn, PersonSummary, PersonVerification, PersonVerified, PersonView } from "../admin/person/types";

/** The read-model parts the person view needs (`eventReadModel` returns all of them). */
export interface PersonModel {
  event: Pick<DomainEvent, "id" | "timezone" | "startsAt">;
  kiosks: { id: string; name: string }[];
  history: { id: string; registrationId: string; from: string | null; to: string; actor: string; reason: string | null; createdAt: Date }[];
}

export const diditSessionUrl = (sessionId: string) => `https://business.didit.me/verification/sessions/${sessionId}`;

/** Name as staff see it everywhere: the profile's full name, else first + last, else the request's name, else the email. */
export function displayName(view: RegistrationView): string {
  const a = view.account;
  return a.fullName?.trim() || [a.firstName, a.lastName].filter(Boolean).join(" ").trim() || view.registration.application.fullName?.trim() || a.email;
}

/** Deleted or being deleted: staff see the request's decisions, never the profile or its photos. */
export const accountGone = (view: RegistrationView) => !!view.account.deletingAt || !!view.account.deletedAt;

/** Versioned staff photo route (private, no-store); the version changes whenever the account row does. */
export function staffPhotoUrl(eventId: string, view: RegistrationView): string | null {
  // The photo route refuses an account that is deleted or being deleted: no URL, no request.
  return view.account.photo && !accountGone(view) ? `/api/admin/events/${eventId}/applicants/${view.registration.id}/photo?v=${view.account.updatedAt.getTime()}` : null;
}

const approvedFaces = (view: RegistrationView) =>
  view.evidence.filter((e) => e.kind === "face" && e.providerStatus === "approved" && !e.invalidatedAt).sort((a, b) => b.establishedAt.getTime() - a.establishedAt.getTime());

/** The current human check: an active, approved, valid face proof. */
export function currentFace(view: RegistrationView, now = new Date()) {
  return approvedFaces(view).find((e) => e.activation === "active" && e.validUntil > now) ?? null;
}

/** The blue badge: the face/human check is approved and current. */
export function personVerified(view: RegistrationView, now = new Date()): PersonVerified | null {
  const face = currentFace(view, now);
  if (!face) return null;
  return { verifiedAt: face.establishedAt.toISOString(), method: face.source === "legacy" ? "Imported verification" : "Selfie liveness", emailVerifiedAt: view.account.emailVerifiedAt?.toISOString() ?? null, createdAt: view.account.createdAt.toISOString() };
}

/** Avatar + badge for a table row. */
export function personSummary(eventId: string, view: RegistrationView, now = new Date(), access: PersonAccess = { photos: false }): PersonSummary {
  const photoUrl = access.photos ? staffPhotoUrl(eventId, view) : null, verified = personVerified(view, now);
  return { ...(photoUrl ? { photoUrl } : {}), ...(verified ? { verified } : {}) };
}

export function personCheckIn(model: PersonModel, view: RegistrationView): PersonCheckIn | null {
  const c = view.checkedIn;
  if (!c) return null;
  const door = c.method === "manual" ? "Manual check-in" : (model.kiosks.find((k) => k.id === c.kioskId)?.name ?? "Kiosk");
  return { at: c.checkedInAt.toISOString(), door, ...(c.byStaff ? { by: c.byStaff } : {}), ...(c.similarity != null ? { match: Math.round(c.similarity) } : {}) };
}

/** What the viewer's event role lets the person view carry: photos and the selfie need guests.photo. */
export interface PersonAccess { photos: boolean }

/** "+34 612 34 56 78" → "+34612345678": the stored proof is E.164, the displayed answer may be formatted. */
const e164 = (value: string) => { const digits = value.replace(/[^0-9]/g, ""); return digits ? `+${digits}` : ""; };

/** The active, approved, current phone proof for exactly this number (a proof of another number never verifies it). */
export function phoneProof(view: RegistrationView, displayed: string, now = new Date()) {
  const number = e164(displayed);
  if (!number) return null;
  return view.evidence.find((e) => e.kind === "phone" && e.providerStatus === "approved" && e.activation === "active" && !e.invalidatedAt && e.validUntil > now
    && typeof e.value === "object" && e.value !== null && (e.value as { e164?: unknown }).e164 === number) ?? null;
}

function verificationFacts(eventId: string, view: RegistrationView, now: Date, access: PersonAccess): Omit<PersonVerification, "checks" | "readiness"> {
  const faces = approvedFaces(view), current = currentFace(view, now), face = current ?? faces[0];
  const sessionOf = (verificationId: string) => view.verifications.find((v) => v.id === verificationId)?.diditSessionId ?? null;
  const latest = view.verifications[0] ?? view.verification;
  const sessionId = face ? sessionOf(face.verificationId) : (latest?.diditSessionId ?? null);
  const state: PersonVerification["state"] = current
    ? "verified"
    : face
      ? "expired"
      : latest?.status === "in_review"
        ? "in_review"
        : latest?.status === "declined"
          ? "declined"
          : latest?.status === "started"
            ? "in_progress"
            : "not_started";
  return {
    state,
    method: face ? (face.source === "legacy" ? "Imported verification" : "Selfie liveness") : null,
    verifiedAt: face?.establishedAt.toISOString() ?? null,
    validUntil: face?.validUntil.toISOString() ?? null,
    sessionId,
    diditUrl: sessionId ? diditSessionUrl(sessionId) : null,
    selfieUrl: access.photos && face && face.source !== "legacy" && !accountGone(view) ? `/api/admin/events/${eventId}/applicants/${view.registration.id}/selfie` : null,
    ...(state === "declined" && latest?.policyReason ? { reason: latest.policyReason } : {}),
  };
}

/**
 * The drawer's person, for a guest or a request. The drawer DTO (`applicantDrawer`: current profile, answers with
 * their labels, accepted checks, full history) is the base; the read model supplies everything the DTO lacks —
 * versioned photo, the badge, email/profile dates, the face proof's Didit session and selfie, consent, check-in.
 * `drawer` is null when the retained request data expired: the account fields still show.
 */
export function personView(model: PersonModel, view: RegistrationView, drawer: ApplicantDrawer | null, access: PersonAccess, now = new Date()): PersonView {
  const a = view.account, r = view.registration, eventId = model.event.id;
  const base = personFromDrawer({ name: displayName(view), email: "", timeZone: model.event.timezone, started: now >= model.event.startsAt }, drawer);
  const checkIn = personCheckIn(model, view);
  const facts = verificationFacts(eventId, view, now, access);
  const history: ApplicantDrawer["history"] =
    drawer?.history ??
    model.history
      .filter((h) => h.registrationId === r.id)
      .map((h) => ({ id: h.id, at: h.createdAt.toISOString(), kind: "admission" as const, label: `${h.from ?? "New"} → ${h.to}`, actorLabel: h.actor, reason: h.reason }));
  const requestedAt = (r.requestCompletedAt ?? r.appliedAt).toISOString();
  const consent = r.requestReceipt?.consent;
  const phoneExtra = (label: string, value: string) => { const proof = phoneProof(view, value, now); return { label, value, verified: !!proof, verifiedAt: proof?.establishedAt.toISOString() ?? null }; };
  const phoneNumber = r.applicationV2?.fields.phone_number;
  // Minimal view for a deleted account: who it was and what was decided, nothing from the profile.
  if (drawer?.accountDeleted || accountGone(view)) {
    return { ...personFromDrawer({ name: displayName(view), email: "", timeZone: model.event.timezone, started: now >= model.event.startsAt }, null), accountDeleted: true,
      request: { requestedAt, answers: [], extras: [], consent: null }, checkIn, timeline: personTimeline(history, { requestedAt, verifiedAt: null, checkIn }) };
  }
  return {
    ...base,
    photoUrl: access.photos ? staffPhotoUrl(eventId, view) : null,
    headline: drawer ? base.headline : (a.headline ?? ""),
    company: drawer ? base.company : (a.company ?? ""),
    role: drawer ? base.role : (a.jobRole ?? ""),
    bio: drawer ? base.bio : (a.bio ?? ""),
    links: drawer ? base.links : (a.profileLinks ?? []).map((l) => ({ kind: linkKind(l.kind, l.href), label: l.label, href: l.href })),
    emailVerifiedAt: a.emailVerifiedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    verified: personVerified(view, now),
    request: {
      ...base.request,
      requestedAt,
      extras: base.request.extras.length
        ? base.request.extras.map((x) => ({ ...x, ...phoneExtra(x.label, x.value) }))
        : phoneNumber
          ? [phoneExtra("Phone", phoneNumber)]
          : [],
      consent: consent ? { acceptedAt: consent.acceptedAt, checks: consent.acceptedChecks.map(checkLabel), eventConsent: consent.eventConsentAccepted, policyVersion: r.policyVersion } : null,
      ...(r.applicationPurgedAt ? { purged: true } : {}),
    },
    verification: { ...base.verification, ...facts },
    checkIn,
    timeline: personTimeline(history, { requestedAt, verifiedAt: facts.verifiedAt, checkIn }),
  };
}
