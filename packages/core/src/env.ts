import { z } from "zod";

const optional = z.string().min(1).optional();
export const DEFAULT_SPEND_CAP_USD = 1000;
const spendCapSchema = z.preprocess(
  value => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.coerce.number().nonnegative().default(DEFAULT_SPEND_CAP_USD),
);

/** An unset or blank total ceiling uses the safety default; explicit zero disables spending. */
export function parseSpendCapUsd(value: string | undefined): number {
  return z.object({ DIDIT_SPEND_CAP_USD: spendCapSchema }).parse({ DIDIT_SPEND_CAP_USD: value }).DIDIT_SPEND_CAP_USD;
}

/** Server-only environment of apps/events. Parsed lazily so builds never need secrets. */
export const serverEnvSchema = z.object({
  DIDIT_API_KEY: z.string().min(1),
  STAFF_EMAIL_DOMAIN: optional,
  CONTACT_EMAIL: optional,
  SEED_OWNER_EMAIL: optional,
  DIDIT_OIDC_CLIENT_ID: optional,
  DIDIT_FACE_WORKFLOW_ID: optional,
  /** Optional: the app that sends sign-in codes when DIDIT_API_KEY is a sandbox app (staging). */
  DIDIT_OTP_API_KEY: optional,
  DIDIT_WORKFLOW_ID: z.string().min(1),
  DIDIT_WEBHOOK_SECRET: optional,
  RESEND_API_KEY: optional,
  RESEND_WEBHOOK_SECRET: optional,
  EMAIL_FROM: optional,
  EMAIL_FOOTER: optional,
  EMAIL_ASSETS_URL: optional,
  APP_URL: z.url(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  DATABASE_URL: optional,
  DIDIT_RENEWAL_WORKFLOW_ID: optional,
  DIDIT_AGE_WORKFLOW_ID: optional,
  DIDIT_AGE_WORKFLOW_MAX_PRICE_USD: z.coerce.number().positive().optional(),
  DIDIT_SPEND_CAP_USD: spendCapSchema,
  DIDIT_APP_DAILY_CAP_USD: z.coerce.number().nonnegative().default(300),
  DIDIT_EVENT_DAILY_CAP_USD: z.coerce.number().nonnegative().default(150),
  /** Optional: "Is this you?" LinkedIn / X suggestions on the profile step (Firecrawl search). Unset turns them off. */
  FIRECRAWL_API_KEY: optional,
  TRUSTED_PROXY_HOPS: z.coerce.number().int().nonnegative().default(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Empty strings (as written by a blank .env line) count as missing.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  return serverEnvSchema.parse(cleaned);
}

/**
 * Sentry error monitoring (apps/events). Every variable is optional and none is needed to build or run: without
 * SENTRY_DSN the server SDK is never initialised. Parsed apart from `serverEnvSchema` because instrumentation reads it
 * before (and without) the app's required secrets. A malformed value turns monitoring off; it never stops the server.
 */
export const sentryEnvSchema = z.object({
  /** Server and edge runtime. Unset: Sentry is off, no network calls. */
  SENTRY_DSN: z.url().optional().catch(undefined),
  /** Browser. Inlined at build time (next.config.ts), so it must be present when `next build` runs. */
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional().catch(undefined),
  /** production | staging. Defaults to DIDIT_ENV. */
  SENTRY_ENVIRONMENT: optional,
  DIDIT_ENV: optional,
  /** Defaults to the build id (NEXT_PUBLIC_BUILD_ID, itself the git sha when the build has GIT_SHA). */
  SENTRY_RELEASE: optional,
  NEXT_PUBLIC_SENTRY_RELEASE: optional,
  /** 0 to 1. 0 (the default) sends errors only. */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).catch(0).default(0),
  /** Build only: source-map upload. Without the token the build is the plain Next build. */
  SENTRY_AUTH_TOKEN: optional,
  SENTRY_ORG: optional,
  SENTRY_PROJECT: optional,
});

export interface SentryEnv { dsn?: string; environment: string; release?: string; tracesSampleRate: number }

export function parseSentryEnv(source: Record<string, string | undefined>): SentryEnv {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([key, v]) => key in sentryEnvSchema.shape && v !== undefined && v.trim() !== ""));
  const env = sentryEnvSchema.parse(cleaned);
  return {
    ...(env.SENTRY_DSN ? { dsn: env.SENTRY_DSN } : {}),
    environment: env.SENTRY_ENVIRONMENT ?? env.DIDIT_ENV ?? "development",
    ...(env.SENTRY_RELEASE ?? env.NEXT_PUBLIC_SENTRY_RELEASE ? { release: env.SENTRY_RELEASE ?? env.NEXT_PUBLIC_SENTRY_RELEASE } : {}),
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  };
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
