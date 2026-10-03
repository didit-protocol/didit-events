import { ApplicantsView } from "../../../../../../../src/admin/applicants/ApplicantsView";
import { parseApplicantQuery } from "../../../../../../../src/admin/applicants/query";

const ZERO = { pending: 0, waitlist: 0, approved: 0, rejected: 0, cancelled: 0 };

// AP-23: toolbar and eight skeleton rows while the applicants load (the header stays from the layout).
export default function ApplicantsLoading() {
  return (
    <>
      <span data-gap="18" hidden />
      <ApplicantsView eventId="" query={parseApplicantQuery({})} counts={ZERO} rows={null} event={{ id: "", capacity: 0, approved: 0, registration: "closed", releaseOn: "", autoPromote: false, requestLink: "" }} />
    </>
  );
}
