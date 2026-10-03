import { PeopleView } from "../../../src/admin/people/PeopleView";
import { parsePeopleQuery } from "../../../src/admin/people/query";

// The People skeleton: toolbar with zero counts, table skeleton rows.
export default function PeopleLoading() {
  return <PeopleView query={parsePeopleQuery({})} counts={{ all: 0, verified: 0, unverified: 0, attended: 0, team: 0, deleted: 0 }} page={null} now={new Date(0)} />;
}
