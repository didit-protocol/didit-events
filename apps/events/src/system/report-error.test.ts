// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ capture: vi.fn(), initBrowserSentry: vi.fn() }));
vi.mock("./sentry-browser", () => ({ initBrowserSentry: sdk.initBrowserSentry }));

const DSN = "https://abc@o1.ingest.sentry.io/2";
let idle: Array<() => void> = [];

beforeEach(() => {
  vi.resetModules();
  sdk.capture.mockClear();
  sdk.initBrowserSentry.mockReset().mockReturnValue(sdk.capture);
  idle = [];
  window.requestIdleCallback = ((run: () => void) => { idle.push(run); return idle.length; }) as typeof window.requestIdleCallback;
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("browser error reporting", () => {
  it("built without a DSN: no listeners, the SDK chunk is never requested, reports go nowhere", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const listen = vi.spyOn(window, "addEventListener");
    const { reportClientError, startErrorReporting } = await import("./report-error");
    startErrorReporting();
    reportClientError(new Error("boom"));
    expect(listen).not.toHaveBeenCalled();
    expect(idle).toHaveLength(0);
    expect(sdk.initBrowserSentry).not.toHaveBeenCalled();
  });
  it("with a DSN: loads the SDK when idle, then replays the errors caught before it was ready", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_RELEASE", "sha-1");
    const unlisten = vi.spyOn(window, "removeEventListener");
    const { reportClientError, startErrorReporting } = await import("./report-error");
    startErrorReporting();
    expect(sdk.initBrowserSentry).not.toHaveBeenCalled();
    const early = new Error("before the SDK"), thrown = new Error("uncaught");
    reportClientError(early);
    window.dispatchEvent(new ErrorEvent("error", { error: thrown, message: "uncaught" }));
    expect(idle).toHaveLength(1);
    idle[0]!();
    await vi.waitFor(() => expect(sdk.initBrowserSentry).toHaveBeenCalledTimes(1));
    expect(sdk.initBrowserSentry).toHaveBeenCalledWith({ dsn: DSN, environment: "staging", release: "sha-1" });
    await vi.waitFor(() => expect(sdk.capture.mock.calls.map(([error]) => error)).toEqual([early, thrown]));
    // Afterwards the SDK's own handlers take over: ours are removed, direct reports go straight through.
    expect(unlisten.mock.calls.map(([type]) => type)).toEqual(["error", "unhandledrejection"]);
    const late = new Error("after");
    reportClientError(late);
    expect(sdk.capture.mock.calls.map(([error]) => error)).toEqual([early, thrown, late]);
  });
  it("error boundaries report a browser error once, and never a server error (it has a digest)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    const { reportBoundaryError, startErrorReporting } = await import("./report-error");
    startErrorReporting();
    const client = new Error("render failed"), server = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "d-1" });
    // A boundary re-renders: the same error object arrives again.
    for (let i = 0; i < 3; i++) { reportBoundaryError(client); reportBoundaryError(server); }
    reportBoundaryError(undefined);
    idle[0]!();
    await vi.waitFor(() => expect(sdk.capture).toHaveBeenCalled());
    expect(sdk.capture.mock.calls.map(([error]) => error)).toEqual([client]);
  });
  it("keeps a bounded queue while the SDK loads", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    const { reportClientError, startErrorReporting } = await import("./report-error");
    startErrorReporting();
    for (let i = 0; i < 50; i++) reportClientError(new Error(`e${i}`));
    idle[0]!();
    await vi.waitFor(() => expect(sdk.capture).toHaveBeenCalledTimes(20));
  });
});
