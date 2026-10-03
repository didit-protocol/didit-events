import type { ApplicantDrawerView } from "../model/contract";
import type { PersonCheckIn, PersonCheck, PersonLink, PersonTimelineItem, PersonTone, PersonView } from "./types";

type DrawerHistory = ApplicantDrawerView["history"][number];

const READINESS: Record<ApplicantDrawerView["readiness"], { text: string; tone: PersonTone }> = {
  ready: { text: "Ready: every accepted check is valid", tone: "ok" },
  renewal_required: { text: "Renewal needed before the event", tone: "warn" },
  review_required: { text: "A check needs review", tone: "review" },
  legacy_completion: { text: "Signed up before profiles: completion pending", tone: "muted" },
};

const CHECK_LABEL: Record<string, string> = { face: "Human / face", phone: "Phone", id_document: "ID document", name_from_id: "Name from ID", age: "Age" };

/** "LinkedIn" / "Website" / "X" from the stored kind and the host. */
export function linkKind(kind: string, href: string): string {
  let host = "";
  try {
    host = new URL(href).host.replace(/^www\./, "");
  } catch {
    /* not a URL: keep the stored kind */
  }
  if (host === "x.com" || host === "twitter.com") return "X";
  if (kind === "linkedin" || host.endsWith("linkedin.com")) return "LinkedIn";
  if (kind === "website") return "Website";
  return "Link";
}

const ADMISSION: Record<string, string> = {
  pending: "Requested",
  approved: "Approved",
  waitlisted: "Waitlisted",
  rejected: "Rejected",
  revoked: "Revoked",
  cancelled_by_guest: "Cancelled by guest",
  cancelled_by_host: "Removed by host",
};

/** "pending → approved" → "approved"; "New → pending" → "pending". */
const admissionTo = (label: string) => label.split("→").at(-1)?.trim() ?? "";

/**
 * Requested → Approved → Verified → Checked in, from real dates: the request submission (or the first pending
 * transition, else the registration's applied_at), the latest approval, the face proof and the current check-in.
 * Other transitions (rejected, waitlisted, revoked…) and undone check-ins follow as audit lines.
 */
export function personTimeline(history: DrawerHistory[], facts: { requestedAt?: string | null; verifiedAt?: string | null; checkIn?: PersonCheckIn | null }): PersonTimelineItem[] {
  const asc = [...history].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const admissions = asc.filter((h) => h.kind === "admission");
  const requested = asc.find((h) => h.kind === "submission") ?? admissions.find((h) => admissionTo(h.label) === "pending");
  const approved = admissions.filter((h) => admissionTo(h.label) === "approved").at(-1);
  const step = (key: string, label: string, at: string | null | undefined, who?: string): PersonTimelineItem => (at ? { key, label, at, who, done: true } : { key, label, at: null, done: false });
  const steps = [
    step("requested", "Requested", requested?.at ?? facts.requestedAt, requested ? requested.actorLabel || undefined : undefined),
    step("approved", "Approved", approved?.at, approved?.actorLabel || undefined),
    step("verified", "Verified", facts.verifiedAt, facts.verifiedAt ? "Didit · selfie liveness" : undefined),
    step("checked-in", "Checked in", facts.checkIn?.at, facts.checkIn ? [facts.checkIn.door, facts.checkIn.by].filter(Boolean).join(" · ") : undefined),
  ];
  const used = new Set([requested?.id, approved?.id]);
  const extra = asc
    .filter((h) => !used.has(h.id))
    .filter((h) => !(h.kind === "admission" && ["pending", "approved"].includes(admissionTo(h.label))))
    .filter((h) => !(h.kind === "checkin" && !/undone/i.test(h.label)))
    .map((h): PersonTimelineItem => {
      const to = h.kind === "admission" ? admissionTo(h.label) : "";
      const label = h.kind === "admission" ? (ADMISSION[to] ?? h.label) : h.label;
      const tone = ["rejected", "revoked", "cancelled_by_host"].includes(to) || /undone/i.test(h.label) ? "danger" : to === "waitlisted" ? "review" : undefined;
      return { key: `h:${h.id}`, label, at: h.at, who: h.actorLabel || undefined, reason: h.reason ?? undefined, tone, done: true };
    });
  return [...steps, ...extra];
}

export interface PersonBase {
  name: string;
  email: string;
  timeZone: string;
  started?: boolean;
}

/**
 * The drawer DTO part (current profile, answers, accepted checks, history). Server loaders overlay the read-model
 * facts (photo, verified badge, verification session, check-in, consent) on top of this; frame fixtures use it as is.
 */
export function personFromDrawer(base: PersonBase, drawer: ApplicantDrawerView | null | undefined): PersonView {
  const p = drawer?.profile;
  const checks: PersonCheck[] = (drawer?.badges ?? []).map((b) => ({ check: b.check, label: b.label, state: b.state, verifiedAt: b.verifiedAt, validUntil: b.validUntil, ...(b.minimum ? { minimum: b.minimum } : {}) }));
  const face = checks.find((c) => c.check === "face");
  const email = checks.find((c) => c.check === "email");
  const phone = checks.find((c) => c.check === "phone");
  const links: PersonLink[] = (p?.links ?? []).map((l) => ({ kind: linkKind(l.kind, l.href), label: l.label, href: l.href }));
  const answers = (drawer?.answers ?? []).filter((a) => a.id !== "phone_number").map((a) => ({ id: a.id, label: a.label, value: a.displayValue, required: a.required, ...(a.kind === "legacy" ? { legacy: true } : {}) }));
  const phoneAnswer = drawer?.answers.find((a) => a.id === "phone_number");
  const verifiedAt = face?.state === "verified" ? face.verifiedAt : null;
  return {
    timeZone: base.timeZone,
    name: base.name,
    email: base.email,
    photoUrl: p?.photoUrl ?? null,
    headline: p?.headline ?? "",
    company: p?.company ?? "",
    role: p?.jobRole ?? "",
    bio: p?.bio ?? "",
    links,
    emailVerifiedAt: email?.state === "verified" ? email.verifiedAt : null,
    createdAt: null,
    verified: verifiedAt ? { verifiedAt, method: "Selfie liveness", emailVerifiedAt: email?.verifiedAt ?? null, createdAt: null } : null,
    updatedSinceRequest: drawer?.updatedSinceRequest ? { from: drawer.profileVersionAtRequest, to: drawer.profile.version } : null,
    request: {
      requestedAt: null,
      answers,
      extras: phoneAnswer ? [{ label: "Phone", value: phoneAnswer.displayValue, verified: phone?.state === "verified", verifiedAt: phone?.state === "verified" ? phone.verifiedAt : null }] : [],
      consent: null,
    },
    verification: {
      state: face?.state === "verified" ? "verified" : face?.state === "expired" ? "expired" : face?.state === "in_review" ? "in_review" : "not_started",
      method: face ? "Selfie liveness" : null,
      verifiedAt,
      validUntil: face?.validUntil ?? null,
      sessionId: null,
      diditUrl: null,
      selfieUrl: null,
      checks: checks.filter((c) => c.check !== "email"),
      readiness: drawer ? READINESS[drawer.readiness] : undefined,
    },
    checkIn: null,
    started: base.started ?? false,
    timeline: personTimeline(drawer?.history ?? [], { verifiedAt }),
  };
}

export const checkLabel = (check: string) => CHECK_LABEL[check] ?? check;
