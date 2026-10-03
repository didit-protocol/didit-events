import { afterEach, describe, expect, it, vi } from "vitest";
import { AdmissionError } from "./admission/shared.ts";
import { ModelError } from "./domain/model-error.ts";
import { isExpectedError, reportUnexpected, setErrorReporter } from "./error-reporting.ts";
import { PolicyError } from "./http/policy.ts";
import { PermanentOutboxError, RetryableOutboxError } from "./outbox.ts";
import { workerLoop } from "./workers.ts";

afterEach(() => setErrorReporter(undefined));

describe("unexpected error reporting", () => {
  it("does nothing without a reporter and never throws when the reporter does", () => {
    expect(() => reportUnexpected(new Error("boom"), { worker: "jobs" })).not.toThrow();
    setErrorReporter(() => { throw new Error("sentry down"); });
    expect(() => reportUnexpected(new Error("boom"), { worker: "jobs" })).not.toThrow();
  });
  it("reports unexpected errors with their tags, not domain failures", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const bug = new TypeError("x is not a function");
    reportUnexpected(bug, { worker: "inbox" });
    expect(reporter).toHaveBeenCalledExactlyOnceWith(bug, { worker: "inbox" });
    for (const expected of [new PolicyError(413, "BodyTooLarge"), new AdmissionError("capacity"), new ModelError("not_found"), new PermanentOutboxError("bounced"), new RetryableOutboxError("rate_limited")]) {
      expect(isExpectedError(expected)).toBe(true);
      reportUnexpected(expected, { worker: "outbox" });
    }
    reportUnexpected(undefined, { worker: "outbox" });
    expect(reporter).toHaveBeenCalledTimes(1);
  });
  it("treats a 5xx domain error and anything untyped as unexpected", () => {
    expect(isExpectedError(new ModelError("provider_unavailable"))).toBe(false);
    expect(isExpectedError(new Error("PolicyError"))).toBe(false);
    expect(isExpectedError("PolicyError")).toBe(false);
    expect(isExpectedError(null)).toBe(false);
  });
  it("the worker loop hands the error of a failed tick to onError and keeps running", async () => {
    const controller = new AbortController(), failure = new Error("database down"), seen: unknown[] = [];
    let ticks = 0;
    await workerLoop(async () => { if (++ticks === 1) throw failure; controller.abort(); }, { signal: controller.signal, intervalMs: 1, onError: error => seen.push(error) });
    expect(ticks).toBe(2);
    expect(seen).toEqual([failure]);
  });
});
