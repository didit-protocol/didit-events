import { queryable, type Db } from "@didit-events/core";
import { getDb } from "@didit-events/core/db";
import { adminLinks } from "../admin/links";
import { linkKind } from "../admin/person/build";
import type { PersonVerificationState, PersonVerified } from "../admin/person/types";
import { PAGE_SIZE } from "../admin/people/query";
import type { PeopleCounts, PeopleDetail, PeopleFilter, PeopleList, PeopleQuery, PeopleRow, PersonActivity, PersonRegistration, RegistrationStatus, StaffRole } from "../admin/people/types";
import { diditSessionUrl } from "./b4-person";

/*
 * People (owner-only, `people.view`): every account with its verification, registrations, attendance and activity.
 * Callers authorize first (app/admin/people/data.ts, the photo route); these functions only read.
 *
 * The list is one SQL statement per page: search, filter, sort and LIMIT/OFFSET run in the database, so the page stays
 * fast with thousands of accounts. Each per-account fact is an index lookup (registrations_account_idx,
 * evidence_account_id_id, verifications_account_idx, sessions_account_idx, checkins_active_registration).
 */

type Value = Date | string | null | undefined;
const iso = (v: Value): string | null => (v == null ? null : new Date(v).toISOString());
const isoOr = (v: Value, fallback: string): string => iso(v) ?? fallback;

/** One row per account with every fact the table filters or sorts on. `$1` is the request time. */
const BASE = `select a.id,a.email,a.headline,a.company,a.email_verified_at,a.created_at,a.updated_at,a.deleting_at,a.deleted_at,
    a.photo is not null as has_photo,
    coalesce(nullif(btrim(a.full_name),''),nullif(btrim(concat_ws(' ',a.first_name,a.last_name)),'')) as display,
    f.established_at as face_at,f.source as face_source,
    (f.established_at is not null and f.activation='active' and f.valid_until>$1) as verified,
    v.status as latest_status,
    coalesce(r.registered,0) as registered,coalesce(r.attended,0) as attended,
    st.role as staff_role,coalesce(m.members,0) as members,
    greatest(a.updated_at,s.last_seen,r.last_registration) as last_active
  from accounts a
  left join lateral (select e.established_at,e.source,e.activation,e.valid_until from evidence e
    where e.account_id=a.id and e.kind='face' and e.provider_status='approved' and e.invalidated_at is null
    order by (e.activation='active' and e.valid_until>$1) desc,e.established_at desc limit 1) f on true
  left join lateral (select x.status from verifications x where x.account_id=a.id order by x.created_at desc limit 1) v on true
  left join lateral (select count(*)::int as registered,count(c.id)::int as attended,max(greatest(g.updated_at,c.checked_in_at)) as last_registration
    from registrations g left join checkins c on c.registration_id=g.id and c.undone_at is null where g.account_id=a.id) r on true
  left join lateral (select max(z.last_seen_at) as last_seen from sessions z where z.account_id=a.id) s on true
  left join staff st on st.email=a.email and st.disabled_at is null
  left join lateral (select count(*)::int as members from event_members em where em.email=a.email and em.revoked_at is null) m on true`;

const FILTER_SQL: Record<PeopleFilter, string> = {
  all: "true",
  verified: "verified",
  unverified: "not verified and deleting_at is null and deleted_at is null",
  attended: "attended>0",
  team: "(staff_role is not null or members>0)",
  deleted: "(deleting_at is not null or deleted_at is not null)",
};
const SORT_SQL: Record<NonNullable<PeopleQuery["sort"]>["key"], string> = {
  name: "lower(coalesce(display,email))",
  email: "email",
  registered: "registered",
  attended: "attended",
  lastActive: "last_active",
  createdAt: "created_at",
};

type BaseRow = {
  id: string; email: string; headline: string | null; company: string | null; email_verified_at: Value; created_at: Value; updated_at: Value;
  deleting_at: Value; deleted_at: Value; has_photo: boolean; display: string | null; face_at: Value; face_source: string | null; verified: boolean;
  latest_status: string | null; registered: number; attended: number; staff_role: StaffRole | null; members: number; last_active: Value;
};

/** Owner photo route, versioned by the account's last update (private, no-store). */
export const peoplePhotoUrl = (id: string, updatedAt: Value) => `/api/admin/people/${id}/photo?v=${new Date(updatedAt ?? 0).getTime()}`;

const method = (source: string | null) => (source === "legacy" ? "Imported verification" : "Selfie liveness");

function verificationState(row: { verified: boolean; face_at: Value; latest_status: string | null }): PersonVerificationState {
  if (row.verified) return "verified";
  if (row.face_at) return "expired";
  return row.latest_status === "in_review" ? "in_review" : row.latest_status === "declined" ? "declined" : row.latest_status === "started" ? "in_progress" : "not_started";
}

function badge(row: Pick<BaseRow, "verified" | "face_at" | "face_source" | "email_verified_at" | "created_at">): PersonVerified | null {
  if (!row.verified || !row.face_at) return null;
  return { verifiedAt: iso(row.face_at)!, method: method(row.face_source), emailVerifiedAt: iso(row.email_verified_at), createdAt: iso(row.created_at) };
}

function peopleRow(r: BaseRow): PeopleRow {
  return {
    id: r.id,
    name: r.display ?? r.email,
    email: r.email,
    emailVerified: !!r.email_verified_at,
    photoUrl: r.has_photo && !r.deleting_at && !r.deleted_at ? peoplePhotoUrl(r.id, r.updated_at) : null,
    headline: r.headline ?? "",
    company: r.company ?? "",
    verified: badge(r),
    verification: verificationState(r),
    registered: r.registered,
    attended: r.attended,
    lastActiveAt: iso(r.last_active),
    createdAt: isoOr(r.created_at, new Date(0).toISOString()),
    staffRole: r.staff_role,
    memberships: r.members,
    deletion: r.deleted_at ? "deleted" : r.deleting_at ? "deleting" : null,
  };
}

/** Name, email or company contains `$2` (null = no search). */
const SEARCH_SQL = "($2::text is null or lower(email) like $2 or lower(coalesce(display,'')) like $2 or lower(coalesce(company,'')) like $2)";

/** `%term%` for LIKE with the wildcards escaped. */
const likeTerm = (q: string) => `%${q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** One page of People plus the chip counts over everyone (counts ignore the search, like the Guests chips). */
export async function peopleList(query: PeopleQuery, db: Db = getDb(), now = new Date()): Promise<PeopleList> {
  const q = queryable(db);
  const search = query.q.trim() ? likeTerm(query.q) : null;
  const sort = query.sort ?? { key: "createdAt" as const, dir: "desc" as const };
  const dir = sort.dir === "asc" ? "asc" : "desc";
  const order = `${SORT_SQL[sort.key]} ${dir} nulls last,id ${dir}`;
  const offset = (query.page - 1) * PAGE_SIZE;
  const [rows, [counts]] = await Promise.all([
    q.query<BaseRow & { total: number }>(
      `with base as (${BASE}) select *,count(*) over()::int as total from base
        where ${FILTER_SQL[query.filter]} and ${SEARCH_SQL}
        order by ${order} limit ${PAGE_SIZE} offset $3`,
      [now, search, offset],
    ),
    q.query<Record<PeopleFilter, number>>(
      `with base as (${BASE}) select ${(Object.keys(FILTER_SQL) as PeopleFilter[]).map((k) => `count(*) filter (where ${FILTER_SQL[k]})::int as "${k}"`).join(",")} from base`,
      [now],
    ),
  ]);
  // Past the last page there are no rows to carry the window count: count once more.
  const total = rows[0]?.total ?? (offset > 0 ? (await q.query<{ n: number }>(`with base as (${BASE}) select count(*)::int as n from base where ${FILTER_SQL[query.filter]} and ${SEARCH_SQL}`, [now, search]))[0]!.n : 0);
  return {
    page: { rows: rows.map(peopleRow), total, page: query.page, pageSize: PAGE_SIZE },
    counts: (counts ?? { all: 0, verified: 0, unverified: 0, attended: 0, team: 0, deleted: 0 }) as PeopleCounts,
  };
}

const ADMISSION: Record<string, RegistrationStatus> = {
  pending: "requested",
  approved: "approved",
  waitlisted: "waitlisted",
  rejected: "rejected",
  cancelled_by_guest: "withdrawn",
  cancelled_by_host: "cancelled",
  revoked: "revoked",
};
const ADMISSION_LABEL: Record<string, string> = {
  pending: "Requested",
  approved: "Approved",
  waitlisted: "Waitlisted",
  rejected: "Rejected",
  cancelled_by_guest: "Withdrew",
  cancelled_by_host: "Removed by host",
  revoked: "Place revoked",
};
const AUDIT_LABEL: Record<string, string> = {
  "account.deletion_requested": "Asked to delete the account",
  "account.google_disconnected": "Disconnected Google",
  "onboarding.re_enrolment": "Started a new face enrolment",
  "verification.deletion_requested": "Deleted their verification",
  evidence_recovered: "Face verification recovered by staff",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything about one account for the People drawer, or null when it does not exist. */
export async function personDetail(id: string, db: Db = getDb(), now = new Date()): Promise<PeopleDetail | null> {
  if (!UUID.test(id)) return null;
  const q = queryable(db);
  const [base] = await q.query<BaseRow>(`with base as (${BASE}) select * from base where id=$2`, [now, id]);
  if (!base) return null;
  const [[account], faces, [latest], identities, methods, registrations, history, submissions, checkins, audit, [staffRow], members] = await Promise.all([
    q.query<{ full_name: string | null; job_role: string | null; bio: string | null; profile_links: { kind: string; label: string; href: string }[] | null; profile_version: number; profile_completed_at: Value; onboarded_at: Value; email_proof_method: string | null }>(
      "select full_name,job_role,bio,profile_links,profile_version,profile_completed_at,onboarded_at,email_proof_method from accounts where id=$1", [id]),
    q.query<{ established_at: Value; valid_until: Value; source: string; activation: string; session: string | null }>(
      `select e.established_at,e.valid_until,e.source,e.activation,v.didit_session_id::text as session from evidence e left join verifications v on v.id=e.verification_id
        where e.account_id=$1 and e.kind='face' and e.provider_status='approved' and e.invalidated_at is null order by (e.activation='active' and e.valid_until>$2) desc,e.established_at desc`, [id, now]),
    q.query<{ status: string; session: string; policy_reason: string | null }>("select status,didit_session_id::text as session,policy_reason from verifications where account_id=$1 order by created_at desc limit 1", [id]),
    q.query<{ issuer: string }>("select issuer from account_identities where account_id=$1", [id]),
    q.query<{ auth_method: string }>("select distinct auth_method::text from sessions where account_id=$1", [id]),
    q.query<{ id: string; event_id: string; slug: string; name: string; starts_at: Value; ends_at: Value; timezone: string; admission: string; requested_at: Value; checked_in_at: Value; purged: boolean }>(
      `select g.id,g.event_id,ev.slug,ev.name,ev.starts_at,ev.ends_at,ev.timezone,g.admission::text,coalesce(g.request_completed_at,g.applied_at) as requested_at,c.checked_in_at,g.application_purged_at is not null as purged
        from registrations g join events ev on ev.id=g.event_id left join checkins c on c.registration_id=g.id and c.undone_at is null
        where g.account_id=$1 order by coalesce(g.request_completed_at,g.applied_at) desc,g.id`, [id]),
    q.query<{ id: string; from: string | null; to: string; actor: string; reason: string | null; created_at: Value; name: string }>(
      `select h.id,h."from"::text,h."to"::text,h.actor,h.reason,h.created_at,ev.name from admission_history h join registrations g on g.id=h.registration_id join events ev on ev.id=g.event_id
        where g.account_id=$1 order by h.created_at desc limit 200`, [id]),
    q.query<{ id: string; created_at: Value; name: string }>(
      `select s.id,s.created_at,ev.name from registration_submissions s join registrations g on g.id=s.registration_id join events ev on ev.id=g.event_id where g.account_id=$1 order by s.created_at desc limit 200`, [id]),
    q.query<{ id: string; checked_in_at: Value; undone_at: Value; method: string; by_staff: string | null; name: string }>(
      `select c.id,c.checked_in_at,c.undone_at,c.method,c.by_staff,ev.name from checkins c join registrations g on g.id=c.registration_id join events ev on ev.id=c.event_id where g.account_id=$1 order by c.checked_in_at desc limit 200`, [id]),
    q.query<{ id: string; action: string; actor: string; created_at: Value }>(
      `select id,action,actor,created_at from audit where actor=$1 or target=$1 or target in (select x.id::text from verifications x where x.account_id=$1::uuid) order by created_at desc limit 200`, [id]),
    q.query<{ role: StaffRole; disabled_at: Value; created_at: Value }>("select role,disabled_at,created_at from staff where email=$1", [base.email]),
    q.query<{ event_id: string; slug: string; name: string; role: "host" | "operator"; created_at: Value }>(
      "select em.event_id,ev.slug,ev.name,em.role,em.created_at from event_members em join events ev on ev.id=em.event_id where em.email=$1 and em.revoked_at is null order by em.created_at desc", [base.email]),
  ]);

  const face = faces[0];
  const state = verificationState(base);
  const sessionId = face?.session ?? latest?.session ?? null;
  const signIn = [
    ...(identities.length || methods.some((m) => m.auth_method === "oidc_google") || account?.email_proof_method === "didit_google" ? ["Google"] : []),
    ...(methods.some((m) => m.auth_method === "email_otp") || account?.email_proof_method === "didit_otp" ? ["Email code"] : []),
  ];

  const regs: PersonRegistration[] = registrations.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    eventName: r.name,
    href: adminLinks.event(r.slug),
    eventStartsAt: isoOr(r.starts_at, ""),
    timeZone: r.timezone,
    status: ADMISSION[r.admission] ?? "requested",
    requestedAt: isoOr(r.requested_at, ""),
    checkedInAt: iso(r.checked_in_at),
  }));
  const approved = registrations.filter((r) => r.admission === "approved").length;
  const attended = registrations.filter((r) => r.checked_in_at).length;
  const noShows = registrations.filter((r) => r.admission === "approved" && !r.checked_in_at && r.ends_at && new Date(r.ends_at) < now).length;

  // The staff selfie route needs a registration whose retained data is still there (the route re-checks it).
  const live = face && face.source !== "legacy" && !base.deleting_at && !base.deleted_at ? registrations.find((r) => !r.purged && r.ends_at && new Date(r.ends_at).getTime() > now.getTime() - 90 * 86_400_000) : undefined;
  const selfieUrl = live ? `/api/admin/events/${live.event_id}/applicants/${live.id}/selfie` : null;

  const activity: PersonActivity[] = [
    { key: "signup", label: "Signed up", at: isoOr(base.created_at, "") },
    ...(base.email_verified_at ? [{ key: "email", label: "Email verified", at: iso(base.email_verified_at)!, tone: "ok" as const }] : []),
    ...(account?.profile_completed_at ? [{ key: "profile", label: "Completed the profile", at: iso(account.profile_completed_at)! }] : []),
    ...(account?.onboarded_at ? [{ key: "onboarded", label: "Finished onboarding", at: iso(account.onboarded_at)! }] : []),
    ...(account && account.profile_version > 1 ? [{ key: "profile-updated", label: "Profile updated", at: isoOr(base.updated_at, ""), detail: `Version ${account.profile_version}` }] : []),
    ...faces.map((f, i) => ({ key: `face:${i}`, label: "Verified by Didit", at: iso(f.established_at)!, detail: method(f.source), tone: "ok" as const })),
    ...submissions.map((s) => ({ key: `sub:${s.id}`, label: "Requested a place", at: iso(s.created_at)!, detail: s.name })),
    ...history
      .filter((h) => !(h.to === "pending" && submissions.length))
      .map((h) => ({
        key: `adm:${h.id}`,
        label: ADMISSION_LABEL[h.to] ?? h.to,
        at: iso(h.created_at)!,
        detail: [h.name, h.actor && h.actor !== id ? h.actor : "", h.reason ? `“${h.reason}”` : ""].filter(Boolean).join(" · "),
        ...(["rejected", "revoked", "cancelled_by_host"].includes(h.to) ? { tone: "danger" as const } : h.to === "waitlisted" ? { tone: "review" as const } : h.to === "approved" ? { tone: "ok" as const } : {}),
      })),
    ...checkins.flatMap((c) => [
      { key: `ci:${c.id}`, label: "Checked in", at: iso(c.checked_in_at)!, detail: [c.name, c.method === "manual" ? `Manual${c.by_staff ? ` by ${c.by_staff}` : ""}` : "Face at the door"].join(" · "), tone: "ok" as const },
      ...(c.undone_at ? [{ key: `undo:${c.id}`, label: "Check-in undone", at: iso(c.undone_at)!, detail: c.name, tone: "danger" as const }] : []),
    ]),
    ...audit.map((a) => ({ key: `audit:${a.id}`, label: AUDIT_LABEL[a.action] ?? a.action, at: iso(a.created_at)!, ...(a.actor !== id ? { detail: a.actor } : {}) })),
    ...(base.deleting_at ? [{ key: "deleting", label: "Account deletion started", at: iso(base.deleting_at)!, tone: "danger" as const }] : []),
    ...(base.deleted_at ? [{ key: "deleted", label: "Account deleted", at: iso(base.deleted_at)!, tone: "danger" as const }] : []),
  ].filter((a) => a.at).sort((x, y) => y.at.localeCompare(x.at) || x.key.localeCompare(y.key));

  return {
    id,
    name: base.display ?? base.email,
    email: base.email,
    photoUrl: peopleRow(base).photoUrl,
    headline: base.headline ?? "",
    company: base.company ?? "",
    role: account?.job_role ?? "",
    bio: account?.bio ?? "",
    links: (account?.profile_links ?? []).map((l) => ({ kind: linkKind(l.kind, l.href), label: l.label, href: l.href })),
    emailVerifiedAt: iso(base.email_verified_at),
    createdAt: isoOr(base.created_at, ""),
    profileVersion: account?.profile_version ?? 1,
    profileCompletedAt: iso(account?.profile_completed_at),
    onboardedAt: iso(account?.onboarded_at),
    lastActiveAt: iso(base.last_active),
    deletingAt: iso(base.deleting_at),
    deletedAt: iso(base.deleted_at),
    verified: badge(base),
    verification: {
      state,
      method: face ? method(face.source) : null,
      verifiedAt: iso(face?.established_at),
      validUntil: iso(face?.valid_until),
      sessionId,
      diditUrl: sessionId ? diditSessionUrl(sessionId) : null,
      ...(state === "declined" && latest?.policy_reason ? { reason: latest.policy_reason } : {}),
    },
    signIn,
    selfieUrl,
    registrations: regs,
    attendance: { registered: registrations.length, approved, attended, noShows },
    staff: staffRow ? { role: staffRow.role, disabledAt: iso(staffRow.disabled_at), since: isoOr(staffRow.created_at, "") } : null,
    memberships: members.map((m) => ({ eventId: m.event_id, eventName: m.name, href: adminLinks.event(m.slug), role: m.role, since: isoOr(m.created_at, "") })),
    activity: activity.slice(0, 150),
  };
}

/** The account photo bytes for the owner photo route, or null (no photo, deleting or deleted). */
export async function peoplePhoto(id: string, db: Db = getDb()): Promise<Uint8Array | null> {
  if (!UUID.test(id)) return null;
  const [row] = await queryable(db).query<{ photo: Uint8Array | null }>("select photo from accounts where id=$1 and deleting_at is null and deleted_at is null", [id]);
  return row?.photo ?? null;
}
