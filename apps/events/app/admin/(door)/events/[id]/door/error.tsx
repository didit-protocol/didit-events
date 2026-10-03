"use client";

import { isStaleDeploy, StaleDeployNotice } from "../../../../../../src/system/StaleDeploy";
import { reportBoundaryError } from "../../../../../../src/system/report-error";
import { AdminErrorView } from "../../../../../../src/admin/system/AdminErrorView";

// A-13c for the kiosk route (outside the admin chrome, so the (events) boundary does not cover it).
export default function DoorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  reportBoundaryError(error);
  if (isStaleDeploy(error)) return <StaleDeployNotice />;
  return <AdminErrorView requestId={error.digest} onRetry={reset} />;
}
