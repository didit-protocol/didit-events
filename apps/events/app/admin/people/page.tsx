import type { Metadata } from "next";
import { requireStaffAccess } from "../../../src/auth/access";
import { adminLinks } from "../../../src/admin/links";
import { PeopleView } from "../../../src/admin/people/PeopleView";
import { parsePeopleQuery } from "../../../src/admin/people/query";
import { getPerson, listPeople } from "./data";

export const metadata: Metadata = { title: "People · Didit Events" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Owner-only: every account on the platform; ?person=<accountId> opens the profile drawer.
// The drawer is a client host inside the list: opening and closing only move the URL (no render of this page). A deep
// link or a refresh still streams that account from here (`seed`), so the drawer does not ask twice.
export default async function PeoplePage({ searchParams }: Props) {
  await requireStaffAccess("people.view", adminLinks.people());
  const query = parsePeopleQuery(await searchParams);
  const detail = query.person ? getPerson(query.person) : null;
  // Not awaited here: it streams to the drawer host. A failure is the host's to handle (it asks the detail route).
  detail?.catch(() => {});
  const list = await listPeople(query);
  // One clock read per request, passed down: relative times render the same on the server and at hydration.
  const now = new Date();
  return (
    <>
      <PeopleView query={query} counts={list.counts} page={list.page} now={now} drawer={{ seed: detail && query.person ? { id: query.person, detail } : undefined }} />
    </>
  );
}
