import { requireStaffAccess } from "../../../src/auth/access";
import { adminLinks } from "../../../src/admin/links";
import type { PeopleDetail, PeopleList, PeopleQuery } from "../../../src/admin/people/types";
import { peopleList, personDetail } from "../../../src/server/people";

/** Owner-only (`people.view`): one page of every account on the platform. */
export async function listPeople(query: PeopleQuery): Promise<PeopleList> {
  await requireStaffAccess("people.view", adminLinks.people());
  return peopleList(query);
}

/** Owner-only (`people.view`): the full profile of one account, or null when it does not exist. */
export async function getPerson(id: string): Promise<PeopleDetail | null> {
  await requireStaffAccess("people.view", adminLinks.people(id));
  return personDetail(id);
}
