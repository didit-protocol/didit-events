"use client";

import { Button } from "@didit-events/ui";
import { SYSTEM_COPY } from "./copy";
import { SystemMessage } from "./SystemMessage";

/** A-13c for the admin error.tsx boundaries: the digest is the request id the server logs carry. */
export function AdminErrorView({ requestId, onRetry }: { requestId?: string; onRetry?: () => void }) {
  const copy = SYSTEM_COPY.broken;
  return (
    <SystemMessage
      role="alert"
      code={copy.code(requestId)}
      title={copy.title}
      help={copy.help}
      action={
        <Button onClick={onRetry}>
          {copy.cta}
        </Button>
      }
    />
  );
}
