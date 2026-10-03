import type { Instrumentation } from "next";

export async function register() {
  // Sentry first, so everything after it is covered. Without SENTRY_DSN the SDK is never loaded.
  if (process.env.SENTRY_DSN && process.env.NEXT_PHASE !== "phase-production-build") {
    try {
      // Keep the literal runtime branches separate so both bundlers omit Node dependencies from Edge.
      if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
      if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
    } catch { console.error("sentry: init failed, monitoring is off"); }
  }
  // Keep the literal runtime branch separate so both bundlers omit Node dependencies from Edge.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    (await import("@didit-events/core/config")).requireInstanceIdentity();
    if (process.env.WORKERS === "0") return;
    await (await import("./src/server/workers")).startWorkers();
  }
}

/**
 * Every server error (pages, server actions, route handlers) into the in-process ring that `system_status` returns, and
 * to Sentry when SENTRY_DSN is set. Each one runs whether or not the other fails.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  try {
    if (process.env.NEXT_RUNTIME === "nodejs") (await import("@didit-events/core/recent-errors")).recordServerError(error, request, context);
  } finally {
    if (process.env.SENTRY_DSN) (await import("./src/system/sentry-server")).captureRequestError(error, request, context);
  }
};
