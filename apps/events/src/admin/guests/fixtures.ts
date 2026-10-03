/**
 * Guests fixtures: the 15 rows of design/01 Admin A-05 (`G`), 109 more deterministic guests so the counts match the
 * chips (All 124 · Checked in 42 · Verified 56 · Link sent 12 · Verifying 4 · In review 3 · Declined 2 · Revoked 5),
 * the A-06 drawer states of María García (design/01b `D`) and the A-07 paste samples.
 */
import { personTimeline } from "../person/build";
import type { PersonCheckIn, PersonView } from "../person/types";
import type { CheckedIn, GuestDetail, GuestRow, GuestSource, GuestStatus } from "./types";

const ci = (v: string): CheckedIn => (v === "Missing" ? { kind: "missing" } : v === "—" ? { kind: "none" } : { kind: "time", time: v });
const slug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const verifyUrl = (code: string) => `https://verify.didit.me/s/${code}`;
const diditUrl = (id: string) => `https://business.didit.me/sessions/${id}`;

type DesignRow = [name: string, reg: string, email: string, status: GuestStatus, ver: string, ci: string, src: GuestSource, flag?: "sending" | "error"];

/** design/01 Admin `G`, in design order. */
const DESIGN: DesignRow[] = [
  ["María García", "Maria Garcia Lopez", "maria.garcia@gmail.com", "checked-in", "Verified · 21 Oct", "19:42", "Request form"],
  ["Oliver Bennett", "", "oliver.bennett@lucerne.test", "checked-in", "Verified · 20 Oct", "19:41", "Added by staff"],
  ["Lucía Fernández", "", "lucia.fdez@example.org", "in-review", "In review · 22 Oct", "—", "Request form"],
  ["Kenji Watanabe", "", "kenji.w@vanarsdel.test", "checked-in", "Verified · 19 Oct", "19:37", "CSV"],
  ["Amara Okafor", "", "amara@relecloud.test", "verified", "Verified · 22 Oct", "Missing", "Request form"],
  ["Jordi Puig", "Jordi Puig i Serra", "jordi.puig@didit.me", "verified", "Verified · 18 Oct", "Missing", "Added by staff"],
  ["Sophie Laurent", "", "sophie.laurent@fourthcoffee.test", "link-sent", "Not started", "—", "CSV"],
  ["Mateo Rossi", "", "mateo.rossi@blueyonder.test", "verifying", "Started · 22 Oct", "—", "Request form"],
  ["Priya Raman", "", "priya.raman@alpineski.test", "approved", "Not started", "—", "Request form", "sending"],
  ["Hannah Schmidt", "", "h.schmidt@litware.test", "declined", "Declined · 21 Oct", "—", "CSV"],
  ["Aiko Tanaka", "", "aiko.tanaka@exmaple.jp", "link-sent", "Not started", "—", "CSV", "error"],
  ["Carlos Mendoza", "", "carlos@margies.test", "checked-in", "Verified · 17 Oct", "19:30", "Added by staff"],
  ["Emma Johansson", "", "emma.j@lamna.test", "verified", "Verified · 21 Oct", "Missing", "Request form"],
  ["Youssef El Amrani", "", "youssef@proseware.test", "revoked", "Revoked · 20 Oct", "—", "Request form"],
  ["Chen Wei", "", "chen.wei@humongous.test", "checked-in", "Verified · 16 Oct", "19:26", "CSV"],
];

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
/** Deterministic 6-char link code per index (María's is the design's 7Hk2Qm). */
const linkCode = (i: number) =>
  i === 0
    ? "7Hk2Qm"
    : Array.from({ length: 6 }, (_, k) => CODE_CHARS[(i * 7919 + k * 104729 + k * k * 31) % CODE_CHARS.length]).join("");

function designRow([name, reg, email, status, ver, c, src, flag]: DesignRow, i: number): GuestRow {
  const id = slug(name);
  return {
    id,
    name,
    person: status === "checked-in" || status === "verified" ? { timeZone: "Europe/Madrid", verified: { verifiedAt: "2026-10-21T07:43:00Z", method: "Selfie liveness", emailVerifiedAt: "2026-10-14T08:10:00Z", createdAt: "2026-02-12T10:00:00Z" } } : undefined,
    registeredAs: reg || undefined,
    email,
    emailVerified: status === "checked-in" || status === "verified",
    status,
    verification: ver,
    bounced: flag === "error" || undefined,
    checkedIn: ci(c),
    source: src,
    sending: flag === "sending" || undefined,
    verifyUrl: verifyUrl(linkCode(i)),
    diditUrl: ver === "Not started" ? undefined : diditUrl(`ses_${id}`),
  };
}

export const DESIGN_GUESTS: GuestRow[] = DESIGN.map(designRow);

const FIRST = ["Ana", "Lukas", "Sara", "Tomás", "Nina", "Pablo", "Elif", "Jonas", "Marta", "Rafael", "Ines", "Omar", "Clara", "Mikkel", "Laura", "Hugo", "Zeynep", "Bruno", "Alba", "Felix", "Noor", "Pau", "Julia", "Ravi", "Sofia", "Ethan", "Irene", "Marco", "Leila", "Arnau", "Freya", "Daniel", "Yara"];
const LAST = ["Costa", "Weber", "Nilsson", "Ruiz", "Keller", "Moreno", "Yilmaz", "Hansen", "Serra", "Almeida", "Novak", "Haddad", "Ferrer", "Lund", "Bianchi", "Dubois", "Aydin", "Santos", "Vidal", "Wagner", "Rahman", "Soler", "Klein", "Iyer", "Marino", "Brooks", "Castro", "Greco", "Mansour", "Pujol", "Olsen", "Levy", "Nasser"];
const DOMAINS = ["contoso.test", "fabrikam.test", "woodgrove.test", "litware.test", "adatum.test", "northwind.test", "tailspin.test", "wingtip.test", "relecloud.test", "lamna.test", "fourthcoffee.test", "globex.test"];
const SOURCES: GuestSource[] = ["Request form", "CSV", "Added by staff"];

/** The rest of the list (109 guests), shaped so the chip counts match the design. */
const GENERATED_PLAN: [GuestStatus, number][] = [
  ["checked-in", 37],
  ["verified", 53],
  ["link-sent", 9],
  ["verifying", 3],
  ["in-review", 2],
  ["declined", 1],
  ["revoked", 4],
];

function generated(): GuestRow[] {
  const out: GuestRow[] = [];
  let n = 0;
  for (const [status, count] of GENERATED_PLAN) {
    for (let k = 0; k < count; k++, n++) {
      const first = FIRST[n % FIRST.length]!;
      const last = LAST[(n * 7 + Math.floor(n / FIRST.length)) % LAST.length]!;
      const name = `${first} ${last}`;
      const email = `${slug(first)}.${slug(last)}${n >= FIRST.length ? n : ""}@${DOMAINS[n % DOMAINS.length]}`;
      const day = 10 + (n % 12);
      const minute = String((n * 13) % 60).padStart(2, "0");
      const ver =
        status === "checked-in" || status === "verified"
          ? `Verified · ${day} Oct`
          : status === "link-sent"
            ? "Not started"
            : status === "verifying"
              ? `Started · ${day} Oct`
              : status === "in-review"
                ? `In review · ${day} Oct`
                : status === "declined"
                  ? `Declined · ${day} Oct`
                  : `Revoked · ${day} Oct`;
      const id = `g-${String(n + 1).padStart(3, "0")}`;
      out.push({
        id,
        name,
        email,
        emailVerified: status === "checked-in" || status === "verified",
        status,
        verification: ver,
        checkedIn: status === "checked-in" ? { kind: "time", time: `${19 + (n % 2)}:${minute}` } : status === "verified" ? { kind: "missing" } : { kind: "none" },
        source: SOURCES[n % SOURCES.length]!,
        verifyUrl: verifyUrl(linkCode(n + 100)),
        diditUrl: status === "link-sent" ? undefined : diditUrl(`ses_${id}`),
      });
    }
  }
  return out;
}

/** Barcelona Office Opening's 124 guests, design rows first (the service's default order on page 1). */
export const BCN_GUESTS: GuestRow[] = [...DESIGN_GUESTS, ...generated()];

export const byId = (id: string) => BCN_GUESTS.find((g) => g.id === id);

/* ── Drawer (design/01b `D`) ───────────────────────────────────────── */

export type DrawerFixture = "not-started" | "in-progress" | "in-review" | "declined" | "verified" | "checked-in" | "manual-checked-in" | "undone" | "email-mismatch";

const TZ = "Europe/Madrid";
const SESSION = "8f2c41a9-3b7d-4e0c-9a51-6d2f0c1be07b";
const DIDIT_URL = `https://business.didit.me/verification/sessions/${SESSION}`;
const H = (id: string, at: string, label: string, actorLabel: string, kind: "admission" | "submission" | "checkin" = "admission", reason: string | null = null) => ({ id, at, kind, label, actorLabel, reason });
const HISTORY = [H("h1", "2026-10-14T08:12:00Z", "Request submitted · policy 1", "Guest", "submission"), H("h2", "2026-10-14T09:03:00Z", "pending → approved", "events.team@didit.me")];
const VERIFIED_AT = "2026-10-21T07:43:00Z";

/** María García's person view in a drawer state (profile, request, verification, check-in, timeline). */
function mariaPerson(state: DrawerFixture, email = "maria.garcia@gmail.com"): PersonView {
  const verified = ["verified", "checked-in", "manual-checked-in", "undone"].includes(state);
  const checkIn: PersonCheckIn | null =
    state === "checked-in" ? { at: "2026-10-23T17:42:00Z", door: "Main door", match: 96 } : state === "manual-checked-in" ? { at: "2026-10-23T17:45:00Z", door: "Manual check-in", by: "Alberto", note: "Face didn’t match with glasses on. ID checked at the door." } : null;
  const history = state === "undone" ? [...HISTORY, H("h3", "2026-10-23T17:48:00Z", "Check-in undone", "Door", "checkin")] : HISTORY;
  const vstate = verified ? "verified" : state === "in-review" || state === "email-mismatch" ? "in_review" : state === "declined" ? "declined" : state === "in-progress" ? "in_progress" : "not_started";
  return {
    timeZone: TZ,
    name: "María García",
    email,
    photoUrl: null,
    headline: "Head of Risk",
    company: "Globex",
    role: "Fraud & Identity",
    bio: "Building fraud tooling for mobility.",
    links: [{ kind: "LinkedIn", label: "LinkedIn", href: "https://www.linkedin.com/in/mariagarcia" }],
    emailVerifiedAt: state === "not-started" ? null : "2026-10-14T08:10:00Z",
    createdAt: "2026-02-12T10:00:00Z",
    verified: verified ? { verifiedAt: VERIFIED_AT, method: "Selfie liveness", emailVerifiedAt: "2026-10-14T08:10:00Z", createdAt: "2026-02-12T10:00:00Z" } : null,
    updatedSinceRequest: null,
    request: {
      requestedAt: "2026-10-14T08:12:00Z",
      answers: [{ id: "q1", label: "What do you want to get out of the evening?", value: state === "not-started" ? "" : "Compare notes on onboarding fraud.", required: false }],
      extras: [],
      consent: { acceptedAt: "2026-10-14T08:12:00Z", checks: ["Human / face"], eventConsent: true, policyVersion: 1 },
    },
    verification: {
      state: vstate,
      method: verified ? "Selfie liveness" : null,
      verifiedAt: verified ? VERIFIED_AT : null,
      validUntil: verified ? "2027-04-19T07:43:00Z" : null,
      sessionId: state === "not-started" ? null : SESSION,
      diditUrl: state === "not-started" ? null : DIDIT_URL,
      selfieUrl: verified ? "/api/admin/events/0b7d4c1e-6f0a-4d9e-9b8a-2f1c3e4d5a6b/applicants/1c8e5d2f-7a1b-4e0f-8c9b-3a2d4e5f6a7b/selfie" : null,
      ...(state === "declined" ? { reason: "screen replay" } : {}),
      checks: [],
    },
    checkIn,
    started: ["checked-in", "manual-checked-in", "undone"].includes(state),
    timeline: personTimeline(history, { requestedAt: "2026-10-14T08:12:00Z", verifiedAt: verified ? VERIFIED_AT : null, checkIn }),
  };
}

const MARIA_BASE = {
  id: "maria-garcia",
  name: "María García",
  email: "maria.garcia@gmail.com",
  invite: { sent: "14 Oct 11:03 · opened 21 Oct", url: verifyUrl("7Hk2Qm"), display: "verify.didit.me/s/7Hk2Qm" },
};

/** María García in every drawer state the design draws (A-06b…g) plus A-14b, A-15b and A-16a. */
export function mariaDetail(state: DrawerFixture): GuestDetail {
  const person = mariaPerson(state);
  switch (state) {
    case "not-started":
      return { ...MARIA_BASE, status: "link-sent", verification: { session: SESSION, state: "not-started" }, person };
    case "in-progress":
      return { ...MARIA_BASE, status: "verifying", verification: { session: SESSION, state: "in-progress" }, person };
    case "in-review":
      return { ...MARIA_BASE, status: "in-review", verification: { session: SESSION, state: "in-review" }, person };
    case "declined":
      return { ...MARIA_BASE, status: "declined", declineReason: "Liveness failed: a screen replay was detected. The guest has 1 retry left.", verification: { session: SESSION, state: "declined" }, person };
    case "verified":
    case "undone":
      return { ...MARIA_BASE, status: "verified", verification: { session: SESSION, state: "approved" }, person };
    case "checked-in":
    case "manual-checked-in":
      return { ...MARIA_BASE, status: "checked-in", verification: { session: SESSION, state: "approved" }, person };
    case "email-mismatch":
      return {
        ...MARIA_BASE,
        email: "maria.garcia@globex.test",
        status: "in-review",
        mismatch: { invited: "maria.garcia@globex.test", verified: "maria.g@gmail.com" },
        verification: { session: SESSION, state: "email-mismatch" },
        person: mariaPerson(state, "maria.garcia@globex.test"),
      };
  }
}

/** Drawer detail for any row of the list (the route): the design's template with the row's name and status. */
export function detailForRow(row: GuestRow): GuestDetail {
  const state: DrawerFixture =
    row.status === "checked-in"
      ? "checked-in"
      : row.status === "verified"
        ? "verified"
        : row.status === "in-review"
          ? "in-review"
          : row.status === "declined"
            ? "declined"
            : row.status === "verifying"
              ? "in-progress"
              : "not-started";
  const base = mariaDetail(state);
  const code = row.verifyUrl.split("/").pop() ?? "";
  return {
    ...base,
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    invite: { ...base.invite, url: row.verifyUrl, display: `verify.didit.me/s/${code}` },
    person: { ...base.person, name: row.name, email: row.email },
  };
}

/* ── Add guests (design/01b `okRows` / `badRows`) ─────────────────── */

const OK_ROWS: [string, string, string][] = [
  ["Ingrid", "Nilsen", "ingrid@initech.test"],
  ["Fatima", "Benali", "fatima.benali@example.net"],
  ["Diego", "Herrera", "diego@hooli.test"],
  ["Nadia", "Kowalski", "nadia.k@contoso.test"],
  ["Tom", "Achterberg", "tom@fabrikam.test"],
  ["Léa", "Moreau", "lea.moreau@northwind.test"],
];
/** 19 more valid rows (the "+ 19 more rows" of A-07c/d). */
const MORE_ROWS: [string, string, string][] = Array.from({ length: 19 }, (_, i) => {
  const first = FIRST[(i * 5 + 3) % FIRST.length]!;
  const last = LAST[(i * 11 + 4) % LAST.length]!;
  return [first, last, `${slug(first)}.${slug(last)}@${DOMAINS[(i + 5) % DOMAINS.length]}`];
});

const line = (r: [string, string, string]) => r.join(", ");

/** A-07c: 25 valid rows (header row included, as a pasted CSV export usually has). */
export const PASTE_VALID = ["First name, Last name, Email", ...OK_ROWS.map(line), ...MORE_ROWS.map(line)].join("\n");

/** A-07d: row 2 has an invalid email, row 4 is already on the guest list. */
export const PASTE_WITH_ERRORS = [
  "First name, Last name, Email",
  line(OK_ROWS[0]!),
  "Fatima, Benali, fatima.benali@orange",
  line(OK_ROWS[2]!),
  "Oliver, Bennett, oliver.bennett@lucerne.test",
  line(OK_ROWS[4]!),
  line(OK_ROWS[5]!),
  ...MORE_ROWS.map(line),
].join("\n");

export const EXISTING_EMAILS = BCN_GUESTS.map((g) => g.email);
