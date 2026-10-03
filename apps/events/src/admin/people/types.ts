import type { PersonLink, PersonVerificationState, PersonVerified } from "../person/types";

/**
 * People (owner-only, capability `people.view`): every account on the platform, one row each, and the full profile
 * drawer. `src/server/people.ts` builds these from the database; dates are ISO strings.
 */

export type PeopleFilter = "all" | "verified" | "unverified" | "attended" | "team" | "deleted";
export type PeopleSortKey = "name" | "email" | "registered" | "attended" | "lastActive" | "createdAt";
export type SortDir = "asc" | "desc";
export type Density = "comfortable" | "compact";

export interface PeopleQuery {
  q: string;
  filter: PeopleFilter;
  sort?: { key: PeopleSortKey; dir: SortDir };
  density: Density;
  page: number;
  /** The account open in the drawer. */
  person?: string;
}

export type PeopleCounts = Record<PeopleFilter, number>;

export type StaffRole = "owner" | "admin" | "staff";

export interface PeopleRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  /** Owner photo route (versioned); null → initials. */
  photoUrl: string | null;
  headline: string;
  company: string;
  verified: PersonVerified | null;
  verification: PersonVerificationState;
  registered: number;
  attended: number;
  lastActiveAt: string | null;
  createdAt: string;
  staffRole: StaffRole | null;
  /** Active event team memberships (host / operator). */
  memberships: number;
  deletion: "deleting" | "deleted" | null;
}

export interface PeoplePage {
  rows: PeopleRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PeopleList {
  page: PeoplePage;
  counts: PeopleCounts;
}

/** A registration as the People drawer lists it; `pending` shows as "Requested", the two cancellations as Withdrawn / Cancelled. */
export type RegistrationStatus = "requested" | "approved" | "waitlisted" | "rejected" | "withdrawn" | "cancelled" | "revoked";

export interface PersonRegistration {
  id: string;
  eventId: string;
  eventName: string;
  /** The event's admin page. */
  href: string;
  eventStartsAt: string;
  timeZone: string;
  status: RegistrationStatus;
  requestedAt: string;
  checkedInAt: string | null;
}

export interface PersonMembership {
  eventId: string;
  eventName: string;
  href: string;
  role: "host" | "operator";
  since: string;
}

export interface PersonActivity {
  key: string;
  label: string;
  at: string;
  /** The event, the actor or the reason. */
  detail?: string;
  tone?: "ok" | "review" | "danger";
}

export interface PeopleDetail {
  id: string;
  name: string;
  email: string;
  photoUrl: string | null;
  headline: string;
  company: string;
  role: string;
  bio: string;
  links: PersonLink[];
  emailVerifiedAt: string | null;
  createdAt: string;
  profileVersion: number;
  profileCompletedAt: string | null;
  onboardedAt: string | null;
  lastActiveAt: string | null;
  deletingAt: string | null;
  deletedAt: string | null;
  verified: PersonVerified | null;
  verification: {
    state: PersonVerificationState;
    method: string | null;
    verifiedAt: string | null;
    validUntil: string | null;
    sessionId: string | null;
    diditUrl: string | null;
    reason?: string;
  };
  /** "Google", "Email code". */
  signIn: string[];
  /** The staff selfie route of one of their registrations (owner clicks "Show selfie"); null when none can show it. */
  selfieUrl: string | null;
  registrations: PersonRegistration[];
  attendance: { registered: number; approved: number; attended: number; noShows: number };
  staff: { role: StaffRole; disabledAt: string | null; since: string } | null;
  memberships: PersonMembership[];
  activity: PersonActivity[];
}
