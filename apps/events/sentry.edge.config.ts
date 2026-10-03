// Loaded by instrumentation.ts in the Edge runtime, only when SENTRY_DSN is set.
import { initServerSentry } from "./src/system/sentry-server";

initServerSentry();
