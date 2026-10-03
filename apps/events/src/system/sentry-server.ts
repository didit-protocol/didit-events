import { parseSentryEnv } from "@didit-events/core/env";
import { setErrorReporter } from "@didit-events/core/error-reporting";
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./sentry-scrub";

/**
 * Sentry for the Node and Edge runtimes (sentry.server.config.ts / sentry.edge.config.ts). Without SENTRY_DSN nothing is
 * initialised: no client, no network calls, and the worker reporter stays unset.
 */
export function initServerSentry(source: Record<string, string | undefined> = process.env): boolean {
  // NEXT_PUBLIC_SENTRY_RELEASE is the build's release, inlined by next.config.ts: the browser and the source maps use it.
  const env = parseSentryEnv({ NEXT_PUBLIC_SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE, ...source });
  if (!env.dsn) return false;
  Sentry.init(sentryOptions({ ...env, dsn: env.dsn }));
  // Worker loops and job handlers (packages/core) report through this: tags only, the event is scrubbed like any other.
  setErrorReporter((error, context) => {
    Sentry.withScope(scope => {
      scope.setTags(context);
      Sentry.captureException(error, { mechanism: { handled: true, type: "didit.worker" } });
    });
  });
  return true;
}

/** Next's onRequestError hook: server components, route handlers, server actions and the proxy. Never throws. */
export function captureRequestError(...args: Parameters<typeof Sentry.captureRequestError>): void {
  try { Sentry.captureRequestError(...args); } catch { /* monitoring must not turn one error into two */ }
}
