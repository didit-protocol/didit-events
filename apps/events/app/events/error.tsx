"use client";

import { isStaleDeploy, StaleDeployNotice } from "../../src/system/StaleDeploy";
import { reportBoundaryError } from "../../src/system/report-error";
import { Button, EmptyState } from "@didit-events/ui";

export default function EventsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  reportBoundaryError(error);
  if (isStaleDeploy(error)) return <StaleDeployNotice />;
  return (
    <main style={{ width: "min(880px, calc(100% - 32px))", margin: "64px auto" }}>
      <EmptyState
        title="We couldn’t load the events"
        description="Try again in a moment."
        action={
          <Button variant="secondary" onClick={reset}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
