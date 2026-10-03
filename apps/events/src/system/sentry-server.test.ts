import { recentServerErrors } from "@didit-events/core/recent-errors";
import { reportUnexpected, setErrorReporter } from "@didit-events/core/error-reporting";
import { PolicyError } from "@didit-events/core/http/policy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_COLLECTION, scrubEvent } from "./sentry-scrub";

const sentry = vi.hoisted(() => {
  const scope = { setTags: vi.fn() };
  return { scope, init: vi.fn(), captureRequestError: vi.fn(), captureException: vi.fn(), withScope: vi.fn((run: (s: typeof scope) => void) => run(scope)) };
});
vi.mock("@sentry/nextjs", () => sentry);

const DSN = "https://abc@o1.ingest.sentry.io/2";
const request = { path: "/admin/events?tab=1", method: "POST", headers: { cookie: "__Host-sid=s3cr3t" } };
const context = { routerKind: "App Router", routePath: "/admin/events", routeType: "action", revalidateReason: undefined } as const;

beforeEach(() => {
  vi.resetModules();
  for (const mock of [sentry.init, sentry.captureRequestError, sentry.captureException, sentry.withScope, sentry.scope.setTags]) mock.mockClear();
  setErrorReporter(undefined);
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("WORKERS", "0");
  vi.stubEnv("SENTRY_DSN", "");
});
afterEach(() => { vi.unstubAllEnvs(); setErrorReporter(undefined); });

describe("initServerSentry", () => {
  it("does not initialise without a DSN, and the worker reporter stays unset", async () => {
    const { initServerSentry } = await import("./sentry-server");
    expect(initServerSentry({})).toBe(false);
    expect(initServerSentry({ SENTRY_DSN: "", SENTRY_ENVIRONMENT: "production" })).toBe(false);
    expect(initServerSentry({ SENTRY_DSN: "not a url" })).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
    reportUnexpected(new Error("boom"), { worker: "jobs" });
    expect(sentry.captureException).not.toHaveBeenCalled();
  });
  it("initialises with the DSN, release, environment and the privacy options", async () => {
    const { initServerSentry } = await import("./sentry-server");
    expect(initServerSentry({ SENTRY_DSN: DSN, DIDIT_ENV: "staging", SENTRY_RELEASE: "sha-1" })).toBe(true);
    expect(sentry.init).toHaveBeenCalledTimes(1);
    const options = sentry.init.mock.calls[0]![0];
    expect(options).toMatchObject({ dsn: DSN, environment: "staging", release: "sha-1", dataCollection: DATA_COLLECTION });
    // The module registry is reset per test, so compare what beforeSend does rather than its identity.
    expect(options.beforeSend.name).toBe(scrubEvent.name);
    expect(options.beforeSend({ user: { email: "ana@example.com" }, message: "for ana@example.com" })).toEqual({ message: "for <email>" });
    // Errors only unless a sample rate is set; no option of the old `sendDefaultPii` kind is passed as true.
    expect(options).not.toHaveProperty("tracesSampleRate");
    expect(options).not.toHaveProperty("sendDefaultPii", true);
  });
  it("routes worker errors to Sentry with their tags, and still skips domain failures", async () => {
    const { initServerSentry } = await import("./sentry-server");
    initServerSentry({ SENTRY_DSN: DSN });
    const failure = new Error("database down");
    reportUnexpected(failure, { worker: "jobs", job: "events:cleanup" });
    expect(sentry.scope.setTags).toHaveBeenCalledExactlyOnceWith({ worker: "jobs", job: "events:cleanup" });
    expect(sentry.captureException).toHaveBeenCalledExactlyOnceWith(failure, { mechanism: { handled: true, type: "didit.worker" } });
    reportUnexpected(new PolicyError(429, "RateLimited"), { worker: "inbox" });
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("instrumentation", () => {
  it("onRequestError records into the error ring and reports to Sentry", async () => {
    vi.stubEnv("SENTRY_DSN", DSN);
    const { onRequestError } = await import("../../instrumentation");
    const error = Object.assign(new Error("ring and sentry"), { digest: "d-both" });
    await onRequestError(error, request, context);
    expect(recentServerErrors()[0]).toMatchObject({ path: "/admin/events", method: "POST", message: "ring and sentry", digest: "d-both", kind: "App Router/action" });
    expect(sentry.captureRequestError).toHaveBeenCalledExactlyOnceWith(error, request, context);
  });
  it("without a DSN the ring still works and Sentry is never called", async () => {
    const { onRequestError, register } = await import("../../instrumentation");
    await register();
    await onRequestError(new Error("ring only"), request, context);
    expect(recentServerErrors()[0]).toMatchObject({ message: "ring only" });
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureRequestError).not.toHaveBeenCalled();
  });
  it("a failure inside Sentry does not reach the caller, and the ring has the error", async () => {
    vi.stubEnv("SENTRY_DSN", DSN);
    sentry.captureRequestError.mockImplementationOnce(() => { throw new Error("sentry down"); });
    const { onRequestError } = await import("../../instrumentation");
    await expect(onRequestError(new Error("still recorded"), request, context)).resolves.toBeUndefined();
    expect(recentServerErrors()[0]).toMatchObject({ message: "still recorded" });
  });
  it("register initialises Sentry in the Node runtime when the DSN is set, and not during the build", async () => {
    vi.stubEnv("SENTRY_DSN", DSN);
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await (await import("../../instrumentation")).register();
    expect(sentry.init).not.toHaveBeenCalled();
    vi.stubEnv("NEXT_PHASE", "");
    await (await import("../../instrumentation")).register();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init.mock.calls[0]![0]).toMatchObject({ dsn: DSN });
  });
});

describe("next.config", () => {
  it("is the plain config without SENTRY_AUTH_TOKEN and inlines an empty browser DSN", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const config = (await import("../../next.config")).default;
    expect(config.output).toBe("standalone");
    expect(config.env).toMatchObject({ NEXT_PUBLIC_SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_RELEASE: config.env!.NEXT_PUBLIC_BUILD_ID });
    expect(config).not.toHaveProperty("webpack");
    expect(Object.keys(config).sort()).toEqual(["agentRules", "distDir", "env", "experimental", "headers", "output", "outputFileTracingIncludes", "outputFileTracingRoot", "poweredByHeader", "serverExternalPackages", "transpilePackages"]);
  });
  it("wraps the config for source-map upload only when the build has SENTRY_AUTH_TOKEN, keeping the standalone output", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "test-token");
    vi.stubEnv("SENTRY_RELEASE", "sha-7");
    const config = (await import("../../next.config")).default as Record<string, unknown> & { env: Record<string, string>; serverExternalPackages: string[] };
    expect(config.output).toBe("standalone");
    expect(config.env).toMatchObject({ _sentryRelease: "sha-7", NEXT_PUBLIC_SENTRY_RELEASE: "sha-7" });
    expect(config.serverExternalPackages).toEqual(expect.arrayContaining(["@electric-sql/pglite", "sharp"]));
    expect(config.experimental).toMatchObject({ authInterrupts: true, serverActions: { bodySizeLimit: "11mb" } });
    expect(config).toHaveProperty("webpack");
  });
  it("takes the browser environment and release from the build", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("NEXT_PUBLIC_ENVIRONMENT", "staging");
    vi.stubEnv("SENTRY_ENVIRONMENT", "");
    vi.stubEnv("SENTRY_RELEASE", "sha-7");
    const config = (await import("../../next.config")).default;
    expect(config.env).toMatchObject({ NEXT_PUBLIC_SENTRY_DSN: DSN, NEXT_PUBLIC_SENTRY_ENVIRONMENT: "staging", NEXT_PUBLIC_SENTRY_RELEASE: "sha-7" });
  });
});
