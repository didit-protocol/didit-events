"use client";

import { isStaleDeploy, StaleDeployNotice } from "../../../src/system/StaleDeploy";
import { reportBoundaryError } from "../../../src/system/report-error";
import { AdminErrorView } from "../../../src/admin/system/AdminErrorView";

// A-13c for /admin/team.
export default function TeamError({ error, reset, retry }: { error: Error & { digest?: string }; reset: () => void; retry?: () => void }) {
  reportBoundaryError(error);
  if (isStaleDeploy(error)) return <StaleDeployNotice />;
  return <AdminErrorView requestId={error.digest} onRetry={retry ?? reset} />;
}
