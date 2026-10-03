"use client";

import { isStaleDeploy, StaleDeployNotice } from "../../../../../../../src/system/StaleDeploy";
import { reportBoundaryError } from "../../../../../../../src/system/report-error";
import { AdminErrorView } from "../../../../../../../src/admin/system/AdminErrorView";

// A-13c inside the event layout: the header and tabs stay, the applicants list failed to load.
export default function ApplicantsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  reportBoundaryError(error);
  if (isStaleDeploy(error)) return <StaleDeployNotice />;
  return <AdminErrorView requestId={error.digest} onRetry={reset} />;
}
