// Runs in the browser before hydration. The Sentry SDK is not part of first-load JS: see src/system/report-error.ts.
import { startErrorReporting } from "./src/system/report-error";

startErrorReporting();
