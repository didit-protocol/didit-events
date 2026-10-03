"use client";

import { isStaleDeploy, StaleDeployNotice } from "../../../src/system/StaleDeploy";
import { reportBoundaryError } from "../../../src/system/report-error";
import { AdminErrorView } from "../../../src/admin/system/AdminErrorView";

// A-13c for /admin and /admin/events/** (inside the sidebar layout). The digest is the id in the server logs.
export default function EventsSectionError({ error, reset, retry }: { error: Error & { digest?: string }; reset: () => void; retry?: () => void }) {
  reportBoundaryError(error);
  if (isStaleDeploy(error)) return <StaleDeployNotice />;
  return <AdminErrorView requestId={error.digest} onRetry={retry ?? reset} />;
}
