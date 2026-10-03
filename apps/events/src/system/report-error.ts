/**
 * Browser error reporting that keeps the SDK out of first-load JS: errors are queued here and the Sentry client (one
 * lazy chunk, ./sentry-browser.ts) loads once the browser is idle, then receives the queue. NEXT_PUBLIC_SENTRY_DSN is
 * inlined at build time (next.config.ts); built without it, the constant is "" and nothing here runs or loads.
 */
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const MAX_QUEUED = 20;
const queue: unknown[] = [];
let capture: ((error: unknown) => void) | undefined;

export function reportClientError(error: unknown): void {
  if (!DSN) return;
  if (capture) capture(error);
  else if (queue.length < MAX_QUEUED) queue.push(error);
}

const reported = new WeakSet<object>();
/**
 * For error boundaries, which swallow what they catch. Called while rendering (the boundaries are also plain functions
 * in tests), so each error object is reported once. An error with a digest was raised on the server and is already
 * reported there by onRequestError; only errors raised in the browser are sent from here.
 */
export function reportBoundaryError(error: (Error & { digest?: string }) | null | undefined): void {
  if (!DSN || typeof window === "undefined" || !error || error.digest || reported.has(error)) return;
  reported.add(error);
  reportClientError(error);
}

export function startErrorReporting(): void {
  if (!DSN || typeof window === "undefined") return;
  const dsn = DSN;
  const onError = (event: ErrorEvent) => reportClientError(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const load = () => {
    import("./sentry-browser").then(sdk => {
      // The SDK installs its own global handlers: hand over, then replay what was caught while it loaded.
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      capture = sdk.initBrowserSentry({ dsn, environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "development", release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined });
      for (const error of queue.splice(0)) capture(error);
    }).catch(() => { /* a failed chunk load must not surface as an app error */ });
  };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(load, { timeout: 3000 });
  else setTimeout(load, 1500);
}
