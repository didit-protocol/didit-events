import { BrowserClient, breadcrumbsIntegration, captureException, dedupeIntegration, defaultStackParser, eventFiltersIntegration, getCurrentScope, globalHandlersIntegration, httpContextIntegration, linkedErrorsIntegration, makeFetchTransport } from "@sentry/browser";
import { BROWSER_IGNORE_ERRORS, sentryOptions } from "./sentry-scrub";

/**
 * The browser Sentry client, loaded on demand by ./report-error.ts. Errors only: a hand-built client with exactly these
 * integrations, so tracing, Session Replay, feedback, profiling and session tracking are not in the bundle at all.
 * Returns the capture function for errors that error boundaries hand over.
 */
export function initBrowserSentry(config: { dsn: string; environment: string; release?: string }): (error: unknown) => void {
  const client = new BrowserClient({
    ...sentryOptions(config),
    ignoreErrors: BROWSER_IGNORE_ERRORS,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [
      eventFiltersIntegration(),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      httpContextIntegration(),
      // No DOM breadcrumbs (selectors can carry names) and no console integration. Requests and navigation only, URLs scrubbed.
      breadcrumbsIntegration({ dom: false, fetch: true, xhr: true, history: true, sentry: true }),
    ],
  });
  getCurrentScope().setClient(client);
  client.init();
  return error => { captureException(error); };
}
