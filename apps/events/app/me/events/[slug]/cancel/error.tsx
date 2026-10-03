"use client";

import { isStaleDeploy, StaleDeployNotice } from "../../../../../src/system/StaleDeploy";
import { reportBoundaryError } from "../../../../../src/system/report-error";
import { FlowError } from "../../../../../src/accounts/components/FlowError";

export default function CancelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  reportBoundaryError(error);
  if (isStaleDeploy(error)) return <StaleDeployNotice />;
  return <FlowError reset={reset} />;
}
