import { describe, expect, it } from "vitest";
import { parseSentryEnv, parseServerEnv, parseSpendCapUsd, sentryEnvSchema, serverEnvSchema } from "./env.ts";

const valid = {
  DIDIT_API_KEY: "key",
  DIDIT_WORKFLOW_ID: "wf",
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "x".repeat(32),
};

describe("server env", () => {
  it.each([[undefined, 1000], ["", 1000], [" \t ", 1000], ["10", 10], ["0", 0]] as const)("parses total spend cap %j as %j", (input, expected) => {
    expect(parseSpendCapUsd(input)).toBe(expected);
    expect(parseServerEnv({ ...valid, DIDIT_SPEND_CAP_USD: input }).DIDIT_SPEND_CAP_USD).toBe(expected);
    expect(serverEnvSchema.parse({ ...valid, DIDIT_SPEND_CAP_USD: input }).DIDIT_SPEND_CAP_USD).toBe(expected);
  });
  it.each(["-1", "abc", "NaN", "Infinity"])("rejects invalid spend cap %s during config validation", input => {
    expect(() => parseServerEnv({ ...valid, DIDIT_SPEND_CAP_USD: input })).toThrow(/DIDIT_SPEND_CAP_USD/);
    expect(() => parseSpendCapUsd(input)).toThrow(/DIDIT_SPEND_CAP_USD/);
  });
  it("accepts a complete environment and leaves optional keys unset", () => {
    const env = parseServerEnv(valid);
    expect(env.SESSION_SECRET).toHaveLength(32);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("rejects a missing SESSION_SECRET", () => {
    const { SESSION_SECRET: _omit, ...rest } = valid;
    expect(() => parseServerEnv(rest)).toThrow(/SESSION_SECRET/);
  });

  it("treats an empty SESSION_SECRET as missing", () => {
    expect(() => parseServerEnv({ ...valid, SESSION_SECRET: "" })).toThrow(/SESSION_SECRET/);
  });
});

describe("Sentry environment", () => {
  it("is off with nothing set: no DSN, errors only, the development environment", () => {
    expect(parseSentryEnv({})).toEqual({ environment: "development", tracesSampleRate: 0 });
    // Blank .env lines count as missing.
    expect(parseSentryEnv({ SENTRY_DSN: "", SENTRY_ENVIRONMENT: " ", SENTRY_TRACES_SAMPLE_RATE: "" })).toEqual({ environment: "development", tracesSampleRate: 0 });
  });
  it("reads the DSN, takes the environment from DIDIT_ENV and the release from the build id unless set", () => {
    const dsn = "https://abc@o1.ingest.sentry.io/2";
    expect(parseSentryEnv({ SENTRY_DSN: dsn, DIDIT_ENV: "staging", NEXT_PUBLIC_SENTRY_RELEASE: "build-1" })).toEqual({ dsn, environment: "staging", release: "build-1", tracesSampleRate: 0 });
    expect(parseSentryEnv({ SENTRY_DSN: dsn, DIDIT_ENV: "staging", SENTRY_ENVIRONMENT: "production", SENTRY_RELEASE: "sha-9", NEXT_PUBLIC_SENTRY_RELEASE: "build-1", SENTRY_TRACES_SAMPLE_RATE: "0.25" }))
      .toEqual({ dsn, environment: "production", release: "sha-9", tracesSampleRate: 0.25 });
  });
  it("turns monitoring off on a malformed value instead of failing startup", () => {
    expect(parseSentryEnv({ SENTRY_DSN: "not a url" }).dsn).toBeUndefined();
    for (const rate of ["2", "-1", "lots"]) expect(parseSentryEnv({ SENTRY_TRACES_SAMPLE_RATE: rate }).tracesSampleRate).toBe(0);
  });
  it("ignores every other variable and never needs the app's required secrets", () => {
    expect(parseSentryEnv({ DATABASE_URL: "postgres://x", SESSION_SECRET: "short" })).toEqual({ environment: "development", tracesSampleRate: 0 });
    expect(Object.keys(sentryEnvSchema.shape)).toEqual(expect.arrayContaining(["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_ENVIRONMENT", "SENTRY_RELEASE", "SENTRY_TRACES_SAMPLE_RATE", "SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"]));
  });
});
