"use client";

import { isStaleDeploy, StaleDeployNotice } from "../../../../../../src/system/StaleDeploy";
import { reportBoundaryError } from "../../../../../../src/system/report-error";
import { RouteError } from "../../../../../../src/admin/form/RouteStates";

export default function EditEventError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  reportBoundaryError(error);
  if (isStaleDeploy(error)) return <StaleDeployNotice />;
  return <RouteError what="this event" onRetry={reset} />;
}
