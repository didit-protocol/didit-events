import { GuestsView } from "../../../../../../../src/admin/guests/GuestsView";
import { parseGuestQuery } from "../../../../../../../src/admin/guests/query";
import type { GuestCounts } from "../../../../../../../src/admin/guests/types";

const ZERO: GuestCounts = { all: 0, "checked-in": 0, verified: 0, "link-sent": 0, verifying: 0, "in-review": 0, declined: 0, revoked: 0, "verified-any": 0 };

// A-05b: toolbar and ten skeleton rows while the guests load (the header stays from the layout).
export default function GuestsLoading() {
  return <GuestsView eventId="" query={parseGuestQuery({})} counts={ZERO} page={null} />;
}
