import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PeopleDrawer } from "./PeopleDrawer";
import { PeopleView } from "./PeopleView";
import { emptyCopy, parsePeopleQuery, peopleHref, relativeWhen } from "./query";
import type { PeopleCounts, PeopleDetail, PeopleRow } from "./types";

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const NOW = new Date("2026-10-01T12:00:00Z");
const ID = "6d0f8f5e-3c0a-4f8e-9a51-1b2c3d4e5f60";
const COUNTS: PeopleCounts = { all: 2, verified: 1, unverified: 1, attended: 1, team: 0, deleted: 0 };
const ANA: PeopleRow = {
  id: ID, name: "Ana García", email: "ana@example.test", emailVerified: true, photoUrl: `/api/admin/people/${ID}/photo?v=1`, headline: "Head of Risk", company: "Globex",
  verified: { verifiedAt: "2026-08-21T10:00:00Z", method: "Selfie liveness", emailVerifiedAt: "2026-08-20T10:00:00Z", createdAt: "2026-08-19T10:00:00Z" },
  verification: "verified", registered: 3, attended: 2, lastActiveAt: "2026-10-01T11:55:00Z", createdAt: "2026-08-19T10:00:00Z", staffRole: null, memberships: 1, deletion: null,
};
const BOB: PeopleRow = { ...ANA, id: "7d0f8f5e-3c0a-4f8e-9a51-1b2c3d4e5f60", name: "Bob", email: "bob@example.test", emailVerified: false, photoUrl: null, verified: null, verification: "not_started", registered: 0, attended: 0, memberships: 0, headline: "", company: "" };

describe("People query", () => {
  it("parses and bounds the URL, and writes it back without defaults", () => {
    const q = parsePeopleQuery({ q: "  ana ", filter: "attended", sort: "registered", dir: "asc", density: "compact", page: "3", person: ID.toUpperCase() });
    expect(q).toEqual({ q: "ana", filter: "attended", sort: { key: "registered", dir: "asc" }, density: "compact", page: 3, person: ID });
    expect(peopleHref(q)).toBe(`/admin/people?q=ana&filter=attended&sort=registered&dir=asc&density=compact&page=3&person=${ID}`);
    expect(parsePeopleQuery({ filter: "nope", sort: "drop table", page: "-1", person: "../x" })).toEqual({ q: "", filter: "all", sort: undefined, density: "comfortable", page: 1, person: undefined });
    expect(peopleHref({})).toBe("/admin/people");
    expect(relativeWhen("2026-10-01T11:57:00Z", NOW)).toBe("3 min ago");
    expect(relativeWhen("2026-09-01T11:57:00Z", NOW)).toBe("1 Sept 2026".replace("Sept", new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date("2026-09-01"))));
  });
});

describe("People table", () => {
  const render = (params: Record<string, string>, rows: PeopleRow[] | null, counts = COUNTS) =>
    decode(renderToStaticMarkup(<PeopleView query={parsePeopleQuery(params)} counts={counts} page={rows ? { rows, total: rows.length, page: 1, pageSize: 25 } : null} now={NOW} />));

  it("renders search, every chip with its count, and each row's columns in all three layouts", () => {
    const html = render({}, [ANA, BOB]);
    expect(html).toContain(">People</h1>");
    expect(html).toContain('placeholder="Search name, email or company"');
    for (const label of ["All", "Verified", "Not verified", "Attended any", "Staff / members", "Deleted / deleting"]) expect(html).toContain(label);
    expect(html).toContain('href="/admin/people?filter=attended"');
    expect(html).toContain("Ana García");
    expect(html).toContain('aria-label="Verified email"');
    expect(html).toContain("Head of Risk · Globex");
    expect(html).toContain("Not verified");
    expect(html).toContain("5 min ago");
    expect(html).toContain("19 Aug 2026");
    expect(html).toContain(`src="/api/admin/people/${ID}/photo?v=1"`);
    expect(html).toContain(`href="/admin/people?person=${ID}"`);
    expect(html).toContain("Event team · 1 event");
    // Sortable columns announce their order; the default is newest sign-ups first.
    expect(html).toMatch(/aria-sort="descending"[^>]*>.*?Signed up/);
    // Compact (1024) and phone (390) lists link to the same drawer.
    expect(html).toContain("3 · 2 in");
    expect(html).toContain("3 events · 2 attended");
  });

  it("keeps the filter and search in the URLs it writes", () => {
    const html = render({ q: "ana", filter: "verified", density: "compact" }, [ANA]);
    expect(html).toContain('<input type="hidden" name="filter" value="verified"/>');
    expect(html).toContain('<input type="hidden" name="density" value="compact"/>');
    expect(html).toContain(`href="/admin/people?q=ana&filter=verified&density=compact&person=${ID}"`);
  });

  it("shows the loading skeleton, the first-run empty state and the filtered empty state", () => {
    expect(render({}, null)).toContain('aria-busy="true"');
    expect(render({}, [], { ...COUNTS, all: 0 })).toContain("No one has signed up yet.");
    const searched = render({ q: "zed" }, []);
    expect(searched).toContain("No one matches “zed”.");
    expect(searched).toContain("Clear search");
    expect(render({ filter: "deleted" }, [])).toContain("Show everyone");
    expect(emptyCopy(5, { q: "", filter: "team" }).title).toBe("No one here yet.");
  });
});

const DETAIL: PeopleDetail = {
  id: ID, name: "Ana García", email: "ana@example.test", photoUrl: `/api/admin/people/${ID}/photo?v=1`, headline: "Head of Risk", company: "Globex", role: "Fraud & Identity", bio: "Building fraud tooling.",
  links: [{ kind: "LinkedIn", label: "LinkedIn", href: "https://www.linkedin.com/in/ana" }, { kind: "Link", label: "Bad", href: "javascript:alert(1)" }],
  emailVerifiedAt: "2026-08-20T10:00:00Z", createdAt: "2026-08-19T10:00:00Z", profileVersion: 3, profileCompletedAt: "2026-08-20T10:05:00Z", onboardedAt: "2026-08-20T10:06:00Z",
  lastActiveAt: "2026-10-01T11:55:00Z", deletingAt: null, deletedAt: null,
  verified: ANA.verified,
  verification: { state: "verified", method: "Selfie liveness", verifiedAt: "2026-08-21T10:00:00Z", validUntil: "2027-02-17T10:00:00Z", sessionId: "11111111-2222-4333-8444-555555555555", diditUrl: "https://business.didit.me/verification/sessions/11111111-2222-4333-8444-555555555555" },
  signIn: ["Google", "Email code"],
  selfieUrl: `/api/admin/events/${ID}/applicants/${ID}/selfie`,
  registrations: [
    { id: "r1", eventId: "e1", eventName: "Barcelona Office Opening", href: "/admin/events/bcn-opening", eventStartsAt: "2026-09-30T17:00:00Z", timeZone: "Europe/Madrid", status: "approved", requestedAt: "2026-09-20T10:00:00Z", checkedInAt: "2026-09-30T17:12:00Z" },
    { id: "r2", eventId: "e2", eventName: "Madrid Fraud Summit", href: "/admin/events/mad-summit", eventStartsAt: "2026-10-20T08:00:00Z", timeZone: "Europe/Madrid", status: "withdrawn", requestedAt: "2026-09-21T10:00:00Z", checkedInAt: null },
    { id: "r3", eventId: "e3", eventName: "Lisbon Meetup", href: "/admin/events/lis", eventStartsAt: "2026-11-02T18:00:00Z", timeZone: "Europe/Lisbon", status: "requested", requestedAt: "2026-09-22T10:00:00Z", checkedInAt: null },
  ],
  attendance: { registered: 3, approved: 1, attended: 1, noShows: 0 },
  staff: null,
  memberships: [{ eventId: "e3", eventName: "Lisbon Meetup", href: "/admin/events/lis", role: "host", since: "2026-09-01T10:00:00Z" }],
  activity: [
    { key: "ci", label: "Checked in", at: "2026-09-30T17:12:00Z", detail: "Barcelona Office Opening · Face at the door", tone: "ok" },
    { key: "adm", label: "Withdrew", at: "2026-09-25T10:00:00Z", detail: "Madrid Fraud Summit" },
    { key: "signup", label: "Signed up", at: "2026-08-19T10:00:00Z" },
  ],
};

describe("People drawer", () => {
  const render = (detail: PeopleDetail | null) => decode(renderToStaticMarkup(<PeopleDrawer detail={detail} closeHref="/admin/people" inline now={NOW.toISOString()} />));

  it("renders the header and every section for a full profile", () => {
    const html = render(DETAIL);
    for (const section of ["Profile", "Verification", "Events · 3", "Attendance", "Team roles", "Activity"]) expect(html).toContain(`aria-label="${section}"`);
    expect(html).toContain("Ana García");
    expect(html).toContain("Head of Risk — Fraud & Identity · Globex");
    expect(html).toContain('href="https://www.linkedin.com/in/ana"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Version 3 · completed 20 Aug 2026");
    expect(html).toContain("Google · Email code");
    expect(html).toContain("Open in Didit ↗");
    // The selfie is never fetched until the owner asks.
    expect(html).toContain("Show selfie");
    expect(html).not.toContain("/selfie\"");
    expect(html).toContain('href="/admin/events/bcn-opening">Barcelona Office Opening</a>');
    for (const status of ["Approved", "Withdrawn", "Requested"]) expect(html).toContain(`>${status}<`);
    expect(html).toContain("Checked in 30 Sept 2026, 19:12".replace("Sept", new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date("2026-09-01"))));
    expect(html).toContain("Came to 100% of the events they were approved for.");
    expect(html).toContain('href="/admin/events/lis">Lisbon Meetup</a> · Host');
    expect(html).toContain("Barcelona Office Opening · Face at the door");
    expect(html).toContain("5 min ago");
  });

  it("shows the empty cases, the deletion callout and the loading skeleton", () => {
    const html = render({ ...DETAIL, registrations: [], memberships: [], activity: [], links: [], signIn: [], selfieUrl: null, deletingAt: "2026-09-30T10:00:00Z", staff: { role: "admin", disabledAt: null, since: "2026-01-01T00:00:00Z" } });
    expect(html).toContain("No registrations yet.");
    expect(html).toContain("Never signed in");
    expect(html).toContain("Account being deleted");
    expect(html).toContain(">Deleting<");
    expect(html).toContain("Admin · since 1 Jan 2026");
    expect(html).not.toContain("Show selfie");
    expect(render(null)).toContain('aria-label="Loading person"');
  });
});
