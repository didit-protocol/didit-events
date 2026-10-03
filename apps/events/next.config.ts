import { contactEmail } from "../../packages/core/src/contact-email.ts";
import { staffEmailDomains } from "../../packages/core/src/staff-email.ts";
import type { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { IMAGE_CSP, securityHeaders } from "./src/system/security-headers.ts";

const buildId = process.env.NEXT_PUBLIC_BUILD_ID ?? process.env.GIT_SHA ?? `build-${Date.now().toString(36)}`;
// One release name for the server, the browser and the uploaded source maps.
const sentryRelease = process.env.SENTRY_RELEASE || buildId;

const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  agentRules: false,
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: ["@didit-events/core", "@didit-events/ui"],
  // PGlite loads its WASM + data bundle from disk at runtime; keep it out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite", "sharp"],
  poweredByHeader: false,
  // The door compares the build it was loaded with to the server's on every poll and offers a reload after a deploy.
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_CONTACT_EMAIL: contactEmail(),
    NEXT_PUBLIC_STAFF_EMAIL_DOMAIN: staffEmailDomains().join(","),
    // Sentry in the browser is configured at build time. Always inlined, so a build without a DSN compiles the
    // reporting code away (src/system/report-error.ts).
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN || "",
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || process.env.NEXT_PUBLIC_ENVIRONMENT || process.env.DIDIT_ENV || "",
    NEXT_PUBLIC_SENTRY_RELEASE: sentryRelease,
  },
  // Let upload actions return field errors above their content limits (square cover + banner: 2 × 5 MB + fields).
  // This is the outer parser ceiling; each action enforces its own smaller body limit.
  experimental: { authInterrupts: true, serverActions: { bodySizeLimit: "11mb" } },
  // The OG cover reads its TTF and pictures from packages/ui at request time (src/public/og.ts).
  outputFileTracingIncludes: { "/e/**": ["../../packages/ui/src/og/*", "../../packages/ui/src/assets/didit-horizontal-color.png"] },
  async headers() {
    // Personal verification links carry a bearer token; the Didit callback carries a session id.
    const noReferrer = [{ key: "Referrer-Policy", value: "no-referrer" }];
    const personal = [...noReferrer, { key: "Cache-Control", value: "private, no-store" }];
    return [
      // Every response: HSTS, nosniff, the default referrer policy, the permissions policy, no framing and the enforced
      // CSP (src/system/security-headers.ts). proxy.ts adds the full policy, report-only, to documents. No route is
      // meant to be embedded. Rules below override a header of the same name; personal pages also prohibit caching.
      // A header set here also replaces the one a route handler sets on its own response (Next.js keeps the first),
      // so what the handlers ask for is restated below.
      { source: "/(.*)", headers: securityHeaders(process.env.NODE_ENV === "production") },
      // API responses never need a referrer; several say so themselves (OIDC start and callback, the event model API,
      // the verification stream, applicant photos).
      { source: "/api/:path*", headers: noReferrer },
      { source: "/api/calendar/:kind", headers: [{ key: "Content-Security-Policy", value: IMAGE_CSP }] },
      { source: "/e/:slug/v/:token", headers: personal },
      { source: "/e/:slug/done", headers: personal },
      // Sign-in/onboarding next URLs can contain an invite or verification token.
      { source: "/login", headers: personal },
      { source: "/admin/login", headers: personal },
      { source: "/me/deleting", headers: personal },
      { source: "/admin/events/:id/door/exit", headers: personal },
      { source: "/onboarding", headers: personal },
      // Direct invites carry a bearer token too (U-24).
      { source: "/i/:token", headers: personal },
    ];
  },
};

// Source maps go to Sentry only when the build has a token. Without one this is the plain config and the Sentry build
// plugin is never loaded. Maps are deleted after the upload, so they are not served to browsers.
export default process.env.SENTRY_AUTH_TOKEN
  ? (createRequire(import.meta.url)("@sentry/nextjs/config") as { withSentryConfig: typeof withSentryConfig }).withSentryConfig(config, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    release: { name: sentryRelease },
    sourcemaps: { deleteSourcemapsAfterUpload: true },
    silent: !process.env.CI,
    telemetry: false,
  })
  : config;
