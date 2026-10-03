/**
 * Deterministic fixtures of the applicant review (design/05 Accounts and Applicants, `A`, the drawers and the tab
 * overrides of `ap`). Names, companies, answers and times are the design's. The frames render these directly; the
 * route's `data.ts` seeds its in-memory store from them until B4 lands.
 */
import type { EventHeaderInfo } from "../types";
import type { ApplicantCounts, ApplicantDetail, ApplicantRow, ApplicantsEvent, ApprovedStatus, RequirementSettings, ShareLinks, SignalTag } from "./types";

/** The real event of design/04 and 05: "Building, Raising & Scaling in the AI Era". */
export const AI_ERA: EventHeaderInfo = {
  id: "ai-era",
  name: "Building, Raising & Scaling in the AI Era",
  status: "open",
  when: "Thu 8 Oct 2026 · 18:30–21:30 CEST · Didit HQ, Barcelona",
  requestLink: "events.didit.me/ai-era",
  guestCount: 84,
  requestCount: 7,
  mode: "request",
};

export const AI_ERA_APPLICANTS: ApplicantsEvent = {
  id: AI_ERA.id,
  approved: 84,
  capacity: 120,
  registration: "open",
  closedOn: "Tue 6 Oct",
  releaseOn: "Mon 5 Oct",
  autoPromote: true,
  requestLink: "events.didit.me/ai-era",
};

/** Segment counts drawn in the design (`C0`). */
export const DESIGN_COUNTS: ApplicantCounts = { pending: 7, waitlist: 12, approved: 84, rejected: 9, cancelled: 4 };

const t = (label: string, tone: SignalTag["tone"]): SignalTag => ({ label, tone });

/** The eight applicants of the design (`A`), all pending. */
export const DESIGN_APPLICANTS: ApplicantRow[] = [
  { id: "ingrid-nilsen", name: "Ingrid Nilsen", email: "ingrid@initech.test", signIn: "google", company: "Initech", role: "Product Lead", why: "Building agent tooling for payments; want to compare notes on AI-native org design.", signals: [t("Verified before", "ok"), t("Attended 1", "neu")], verified: true, requested: "2h ago", tab: "pending" },
  { id: "diego-herrera", name: "Diego Herrera", email: "diego@hooli.test", signIn: "email", company: "Hooli", role: "Fraud Analyst", why: "Raising our seed next year and deciding between SF and Madrid.", signals: [t("New account", "neu")], verified: false, requested: "5h ago", tab: "pending" },
  { id: "nadia-kowalski", name: "Nadia Kowalski", email: "nadia.k@contoso.test", signIn: "google", company: "Contoso", role: "Compliance Manager", why: "Curious how AI-first startups handle KYC from day one.", signals: [t("Verified before", "ok")], verified: false, requested: "Yesterday", tab: "pending" },
  { id: "tom-achterberg", name: "Tom Achterberg", email: "tom@fabrikam.test", signIn: "google", company: "Fabrikam", role: "CTO", why: "Want to hear the SF vs EU panel, we are hiring in both.", signals: [t("Attended 2", "neu"), t("VIP", "brand")], verified: true, requested: "Yesterday", tab: "pending" },
  { id: "lea-moreau", name: "Léa Moreau", email: "lea.moreau@northwind.test", signIn: "email", company: "Northwind", role: "Engineer", why: "Our team ships with agents daily, would love to meet others doing it.", signals: [], verified: false, requested: "28 Sep", tab: "pending" },
  { id: "samuel-osei", name: "Samuel Osei", email: "samuel@tailspin.test", signIn: "google", company: "Tailspin", role: "Head of KYC", why: "In Barcelona that week for a conference.", signals: [t("Verified before", "ok")], verified: false, requested: "27 Sep", tab: "pending" },
  { id: "isabel-costa", name: "Isabel Costa", email: "isabel.costa@wingtip.test", signIn: "email", company: "Wingtip", role: "Risk Ops", why: "Interested in both panels.", signals: [t("Possible duplicate", "warn")], verified: false, requested: "27 Sep", tab: "pending" },
  { id: "kwame-mensah", name: "Kwame Mensah", email: "kwame@example.com", signIn: "email", company: "Independent", role: "Founder", why: "—", signals: [t("No company", "neu")], verified: false, requested: "26 Sep", tab: "pending" },
];

/** AP-12: the same people as waitlist #1…#8. */
export const WAITLIST_ROWS: ApplicantRow[] = DESIGN_APPLICANTS.map((r, i) => ({ ...r, id: `wl-${r.id}`, tab: "waitlist", position: i + 1 }));

const APPROVED: [string, ApprovedStatus][] = [
  ["Verified 1 Oct · face on file", "going"],
  ["Link sent 29 Sep · not opened", "link-sent"],
  ["In review since 10:14", "in-review"],
  ["Verified 30 Sep", "going"],
  ["Started · selfie missing", "verifying"],
  ["Verified 14 Apr (returning)", "going"],
  ["Declined · 1 retry left", "declined"],
  ["Link expired 28 Sep", "expired"],
];
/** AP-13: approved guests with their verification status. */
export const APPROVED_ROWS: ApplicantRow[] = DESIGN_APPLICANTS.map((r, i) => ({ ...r, id: `ok-${r.id}`, tab: "approved", approval: { line: APPROVED[i]![0], status: APPROVED[i]![1] } }));

const REJECTED = ["At capacity", "Duplicate of isabel.c@gmail.com", "Not a fit for this audience", "Incomplete answers"];
/** AP-14: rejected with the internal reason; the third was not emailed. */
export const REJECTED_ROWS: ApplicantRow[] = DESIGN_APPLICANTS.slice(0, 4).map((r, i) => ({ ...r, id: `rj-${r.id}`, tab: "rejected", rejection: { reason: REJECTED[i]!, emailed: i !== 2 } }));

const CANCELLED: [string, string][] = [
  ["Schedule conflict", "2 Oct"],
  ["Travel plans changed", "3 Oct"],
  ["Other: “A colleague from Hooli is going instead”", "5 Oct"],
  ["Feeling unwell", "7 Oct 19:40"],
];
/** AP-15: cancelled by the guest; the last one late (<24 h). */
export const CANCELLED_ROWS: ApplicantRow[] = DESIGN_APPLICANTS.slice(0, 4).map((r, i) => ({ ...r, id: `cx-${r.id}`, tab: "cancelled", cancellation: { reason: CANCELLED[i]![0], when: CANCELLED[i]![1], late: i === 3 } }));

/* ── Drawers ─────────────────────────────────────────────────────── */

/** AP-03 new account. */
export const DRAWER_NEW: ApplicantDetail = {
  id: "diego-herrera",
  name: "Diego Herrera",
  email: "diego@hooli.test",
  initials: "DH",
  tab: "pending",
  sections: [
    { title: "Account", rows: [{ k: "Sign-in method", v: "Email code" }, { k: "Account created", v: "29 Sep, 13:02 · with this request" }, { k: "Email confirmed", v: "Yes · via email code", tone: "ok" }, { k: "Didit verification", v: "Not yet · starts after approval", tone: "muted" }] },
    { title: "Request answers", rows: [{ k: "Company", v: "Hooli" }, { k: "Role", v: "Fraud Analyst" }, { k: "LinkedIn", v: "linkedin.com/in/diegoherrera", tone: "link", href: "https://linkedin.com/in/diegoherrera" }, { k: "Why", v: "Raising our seed next year and deciding between SF and Madrid." }] },
    { title: "History with Didit Events", rows: [{ k: "Past events", v: "None", tone: "muted" }, { k: "Other requests", v: "None", tone: "muted" }] },
    { title: "Staff note", rows: [], note: { value: "", placeholder: "Add a private note…" } },
  ],
};

/** AP-04 returning verified guest. */
export const DRAWER_RETURNING: ApplicantDetail = {
  id: "tom-achterberg",
  name: "Tom Achterberg",
  email: "tom@fabrikam.test",
  initials: "TA",
  tab: "pending",
  flag: { text: "Returning guest · attended 2 Didit events · verified with Didit on 14 Apr", tone: "ok" },
  sections: [
    { title: "Account", rows: [{ k: "Sign-in method", v: "Google · tom@fabrikam.test" }, { k: "Account created", v: "2 Apr 2026" }, { k: "Didit verification", v: "Verified · face on file, no new selfie needed", tone: "ok" }] },
    { title: "Request answers", rows: [{ k: "Company", v: "Fabrikam" }, { k: "Role", v: "CTO" }, { k: "Why", v: "Want to hear the SF vs EU panel, we are hiring in both." }] },
    { title: "History with Didit Events", rows: [{ k: "San Francisco Launch Night", v: "Checked in 18:51 · 14 Apr", tone: "ok" }, { k: "Amsterdam Partner Evening", v: "Checked in 19:12 · 3 Jun", tone: "ok" }, { k: "No-shows", v: "0" }] },
    { title: "Staff note", rows: [], note: { value: "Speaker candidate for panel 02 — Alejandro", placeholder: "Add a private note…" } },
  ],
};

/** AP-05 possible duplicate. */
export const DRAWER_DUPLICATE: ApplicantDetail = {
  id: "isabel-costa",
  name: "Isabel Costa",
  email: "isabel.costa@wingtip.test",
  initials: "IC",
  tab: "pending",
  flag: { text: "Possible duplicate: same name and company as isabel.c@gmail.com (approved 25 Sep). One face check-in per person, so only one can attend.", tone: "warn" },
  sections: [
    { title: "Account", rows: [{ k: "Sign-in method", v: "Email code" }, { k: "Account created", v: "27 Sep" }] },
    { title: "Matching account", rows: [{ k: "Email", v: "isabel.c@gmail.com" }, { k: "Status", v: "Approved · link sent 25 Sep", tone: "warn" }, { k: "", v: "Open matching guest ↗", tone: "link", href: "/admin/events/ai-era/applicants?tab=approved&q=isabel.c%40gmail.com" }] },
    { title: "Suggested action", rows: [{ k: "", v: "Reject as duplicate, or approve and revoke the older one." }] },
  ],
};

/** AP-26 meets all requirements (María García, design/05 profile). */
export const DRAWER_MEETS_ALL: ApplicantDetail = {
  id: "maria-garcia",
  name: "María García",
  email: "maria.garcia@gmail.com",
  initials: "MG",
  tab: "pending",
  flag: { text: "Meets all 3 requirements with a verified Didit profile. Approving sends the ticket straight away (M-06).", tone: "ok" },
  sections: [
    { title: "Profile", rows: [{ k: "Headline", v: "Head of Risk · Globex · Barcelona" }, { k: "Bio", v: "Building fraud tooling for mobility. Previously payments risk at Litware. Into AI agents for ops." }, { k: "Links", v: "LinkedIn · mariagarcia.com", tone: "link", href: "https://mariagarcia.com" }] },
    { title: "Event requirements", rows: [{ k: "Full name", v: "✓ Verified 1 Oct 2026", tone: "ok" }, { k: "Email", v: "✓ Verified 1 Oct 2026", tone: "ok" }, { k: "Selfie · liveness", v: "✓ Valid until 1 Oct 2027", tone: "ok" }] },
    { title: "Account", rows: [{ k: "Sign-in methods", v: "Google + email code" }, { k: "Account created", v: "12 Feb 2026" }, { k: "Past events", v: "3 attended · 0 no-shows" }] },
  ],
};

/** AP-28 event model v2 drawer: the full profile, photo, links, badges, every answer and history (ApplicantDrawer DTO). */
export const DRAWER_V2: ApplicantDetail = {
  id: "maria-garcia",
  name: "María García",
  email: "maria.garcia@gmail.com",
  initials: "M",
  tab: "pending",
  timeZone: "Europe/Madrid",
  flag: { text: "Ready: completed every check this event asks for. Approving sends “You're in” (M-06).", tone: "ok" },
  v2: {
    registrationId: "maria-garcia",
    eventId: "ai-era",
    accountId: "0b7d4c1e-6f0a-4d9e-9b8a-2f1c3e4d5a6b",
    admission: "pending",
    readiness: "ready",
    profile: {
      fullName: "María García",
      headline: "Head of Risk",
      company: "Globex",
      jobRole: "Fraud & Identity",
      bio: "Building fraud tooling for mobility. Previously payments risk at Litware. Into AI agents for ops.",
      links: [
        { kind: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/in/mariagarcia" },
        { kind: "website", label: "mariagarcia.com", href: "https://mariagarcia.com/" },
      ],
      email: "maria.garcia@gmail.com",
      photoUrl: null,
      version: 3,
    },
    profileVersionAtRequest: 2,
    updatedSinceRequest: true,
    acceptedPolicyVersion: 2,
    formVersion: 2,
    badges: [
      { check: "email", label: "Email", state: "verified", verifiedAt: "2026-02-12T10:04:00Z", validUntil: null, source: "sign_in" },
      { check: "face", label: "Face · selfie", state: "verified", verifiedAt: "2026-10-01T11:02:00Z", validUntil: "2027-03-30T11:02:00Z", source: "liveness" },
      { check: "phone", label: "Phone", state: "verified", verifiedAt: "2026-10-01T11:05:00Z", validUntil: "2027-10-01T11:05:00Z", source: "phone" },
      { check: "age", label: "Age", state: "verified", verifiedAt: "2026-10-01T11:06:00Z", validUntil: "2027-10-01T11:06:00Z", source: "document", minimum: 18 },
    ],
    answers: [
      { id: "6c1f3d2a-0e4b-4a7c-9d8e-1f2a3b4c5d6e", label: "What do you want to get out of the evening?", kind: "long", value: "Compare notes on onboarding fraud with other founders.", displayValue: "Compare notes on onboarding fraud with other founders.", required: true },
      { id: "7d2e4f3b-1a5c-4b8d-8e9f-2a3b4c5d6e7f", label: "Which panel interests you most?", kind: "single", value: "b1", displayValue: "Raising in SF vs EU", required: false },
      { id: "8e3f5a4c-2b6d-4c9e-9fa0-3b4c5d6e7f80", label: "Happy to be photographed?", kind: "yes_no", value: true, displayValue: "Yes", required: true },
      { id: "legacy:why", label: "Why do you want to come?", kind: "legacy", value: "Heard great things about the last one.", displayValue: "Heard great things about the last one.", required: false },
    ],
    history: [
      { id: "h1", at: "2026-10-01T11:08:00Z", kind: "submission", label: "Requested a place", actorLabel: "María García", reason: null },
      { id: "h2", at: "2026-10-01T11:06:00Z", kind: "verification", label: "Age 18+ verified from ID", actorLabel: "Didit", reason: null },
      { id: "h3", at: "2026-04-14T18:51:00Z", kind: "checkin", label: "Checked in · San Francisco Launch Night", actorLabel: "Kiosk", reason: null },
    ],
    staffNote: null,
    lateCancellation: false,
    actions: { approve: true, waitlist: true, reject: true, revoke: false, resendRenewal: false, blockedReason: null },
  },
  sections: [{ title: "Staff note", rows: [], note: { value: "", placeholder: "Add a private note…" } }],
};

/** Drawer for any other row: its account and answers (verified rows get the AP-26 requirement block). */
export function detailForRow(row: ApplicantRow): ApplicantDetail {
  const initials = row.name.split(" ").map((x) => x[0]).join("").slice(0, 2);
  const answers = { title: "Request answers", rows: [{ k: "Company", v: row.company }, { k: "Role", v: row.role }, { k: "Why", v: row.why }] };
  const account = { title: "Account", rows: [{ k: "Sign-in method", v: row.signIn === "google" ? `Google · ${row.email}` : "Email code" }, row.verified ? { k: "Didit verification", v: "Verified · face on file, no new selfie needed", tone: "ok" as const } : { k: "Didit verification", v: "Not yet · starts after approval", tone: "muted" as const }] };
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    initials,
    tab: row.tab,
    flag: row.verified ? { text: "Meets all 3 requirements with a verified Didit profile. Approving sends the ticket straight away (M-06).", tone: "ok" } : undefined,
    sections: [account, answers, { title: "Staff note", rows: [], note: { value: "", placeholder: "Add a private note…" } }],
  };
}

/* ── Invites + requirements ─────────────────────────────────────── */

export const SHARE_LINKS: ShareLinks = {
  publicLink: "events.didit.me/ai-era",
  privateLink: "events.didit.me/ai-era?inv=8Kq2w",
  privateHint: "Skips approval. 20 uses left · expires Tue 6 Oct. Revoke anytime.",
};

/** AP-17 pasted emails and message. */
export const INVITE_EMAILS = ["alex@adatum.test", "marta@woodgrove.test", "pau@proseware", "tom@fabrikam.test", "ines@seedfund.test"];
export const INVITE_MESSAGE = "Would love to have you on the SF vs EU panel crowd. — Alejandro";

/** AP-27 as drawn: name, email and selfie on; document and age off; reuse 12 months. */
export const DEFAULT_REQUIREMENTS: RequirementSettings = { name: true, email: true, liveness: true, document: false, age18: false, reuseMonths: 12, editVersion: 1 };
