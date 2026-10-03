import { TeamView } from "../../../src/admin/team/TeamView";

// A-12b. The viewer is not known inside a loading boundary, so it shows the read-only skeleton.
export default function TeamLoading() {
  return <TeamView viewer={{ name: "", email: "", initials: "", role: "staff" }} members={null} now={new Date(0)} manage={false} />;
}
