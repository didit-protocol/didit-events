/**
 * Unexpected errors raised outside a request (worker loops, job and webhook handlers). apps/events points the reporter
 * at Sentry when SENTRY_DSN is set; otherwise reporting does nothing. The context is tags only (worker and job names):
 * never payloads, ids or emails.
 */
export type ErrorReporter = (error: unknown, context: Record<string, string>) => void;
// On globalThis: Next bundles instrumentation.ts apart from the route handlers, so a module variable would not be shared.
const store = globalThis as typeof globalThis & { __diditErrorReporter?: ErrorReporter };
export function setErrorReporter(reporter: ErrorReporter | undefined): void { store.__diditErrorReporter = reporter; }

const DOMAIN_ERRORS = new Set(["PolicyError", "IdentityError", "AdmissionError", "ModelError", "PermanentOutboxError", "RetryableOutboxError"]);
/** A domain failure the app answers by design (a 4xx, or an outbox result that is retried or parked): not a defect. */
export function isExpectedError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { name, status } = error as { name?: unknown; status?: unknown };
  return typeof name === "string" && DOMAIN_ERRORS.has(name) && !(typeof status === "number" && status >= 500);
}

/** Never throws: monitoring must not change what the caller does next. */
export function reportUnexpected(error: unknown, context: Record<string, string>): void {
  if (error === undefined || isExpectedError(error)) return;
  try { store.__diditErrorReporter?.(error, context); } catch { /* reporting is best effort */ }
}
