import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { register } from "../../instrumentation";
import { startWorkers, stopWorkers } from "../server/workers";
import { jobHandlers } from "@didit-events/core/jobs";
const calls = vi.hoisted(() => ({ admission: vi.fn(), initialize: vi.fn(), inbox: vi.fn(), outbox: vi.fn(), jobs: vi.fn(), notifications: vi.fn(), schedule: vi.fn(), scheduleJob: vi.fn(), log: vi.fn() }));
vi.mock("@didit-events/core/db", () => ({ getDb: vi.fn() }));
vi.mock("@didit-events/core/db/tx", () => ({ queryable: vi.fn() }));
vi.mock("@didit-events/core/identity", () => ({ identity: { processDeletions: vi.fn() } }));
vi.mock("@didit-events/core/admission/jobs", () => ({ registerAdmissionJobs: calls.admission }));
vi.mock("@didit-events/core/jobs", () => ({ runJobs: calls.jobs, jobHandlers: { get: vi.fn(() => true), register: vi.fn() }, scheduleJob: calls.scheduleJob }));
vi.mock("@didit-events/core", () => ({ initializeVerificationWorkers: calls.initialize, runInbox: calls.inbox, runOutbox: calls.outbox, log: calls.log }));
vi.mock("@didit-events/core/notifications", () => ({ registerNotifications: calls.notifications, scheduleLifecycleJobs: calls.schedule, emailConfigFromEnv: () => ({ from: "test" }) }));
const state = globalThis as typeof globalThis & { __eventsWorkerState?: unknown };
let term: Set<ReturnType<typeof process.listeners>[number]>, interrupt: Set<ReturnType<typeof process.listeners>[number]>;
beforeEach(() => {
  vi.resetAllMocks();
  for (const fn of [calls.inbox, calls.outbox, calls.jobs]) fn.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })));
  term = new Set(process.listeners("SIGTERM")); interrupt = new Set(process.listeners("SIGINT"));
  delete state.__eventsWorkerState;
  vi.stubEnv("NEXT_RUNTIME", "nodejs"); vi.stubEnv("NEXT_PHASE", ""); vi.stubEnv("WORKERS", "1"); vi.stubEnv("VERIFICATION_WORKERS", "1");
  vi.stubEnv("NEXT_MANUAL_SIG_HANDLE", "");
  vi.stubEnv("DIDIT_API_KEY", "test"); vi.stubEnv("RESEND_API_KEY", "test"); vi.stubEnv("EMAIL_FROM", "Didit Events <events@updates.didit.me>"); vi.stubEnv("EMAIL_FOOTER", "Example Events · 1 Example Street, Lisbon");
});
afterEach(async () => {
  await stopWorkers(); delete state.__eventsWorkerState;
  for (const fn of process.listeners("SIGTERM")) if (!term.has(fn)) process.removeListener("SIGTERM", fn);
  for (const fn of process.listeners("SIGINT")) if (!interrupt.has(fn)) process.removeListener("SIGINT", fn);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("registers once even with concurrent calls; all handlers precede dispatch; logs one start per loop", async () => {
  await Promise.all([register(), register(), register()]);
  await register();
  for (const [name, fn] of Object.entries(calls)) if (!["scheduleJob", "log"].includes(name)) expect(fn, name).toHaveBeenCalledTimes(1);
  expect(calls.notifications.mock.invocationCallOrder[0]).toBeLessThan(calls.outbox.mock.invocationCallOrder[0]!);
  expect(calls.initialize.mock.invocationCallOrder[0]).toBeLessThan(calls.inbox.mock.invocationCallOrder[0]!);
  expect(calls.admission.mock.invocationCallOrder[0]).toBeLessThan(calls.jobs.mock.invocationCallOrder[0]!);
  expect(calls.initialize).toHaveBeenCalledWith(jobHandlers);
  expect(calls.notifications).toHaveBeenCalledWith({ from: "test" }, { jobs: jobHandlers });
  expect(calls.jobs).toHaveBeenCalledWith(expect.objectContaining({ beforeTick: expect.any(Function) }), undefined, jobHandlers);
  await calls.jobs.mock.calls[0]![0].beforeTick();
  expect(calls.admission).toHaveBeenLastCalledWith(jobHandlers);
  expect(calls.admission).toHaveBeenCalledTimes(2);
  expect(calls.log.mock.calls).toEqual(["inbox", "outbox", "jobs"].map(worker => ["events.worker_started", { worker }]));
});
it.each(["disabled", "build", "edge"])("starts nothing when %s", async mode => {
  if (mode === "disabled") vi.stubEnv("WORKERS", "0");
  if (mode === "build") vi.stubEnv("NEXT_PHASE", "phase-production-build");
  if (mode === "edge") vi.stubEnv("NEXT_RUNTIME", "edge");
  await register(); for (const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
});
it("WORKERS=0 also guards direct startup", async () => { vi.stubEnv("WORKERS", "0"); await startWorkers(); expect(state.__eventsWorkerState).toBeUndefined(); });
it("runs scheduler cleanup without provider credentials", async () => {
  vi.stubEnv("DIDIT_API_KEY", ""); vi.stubEnv("RESEND_API_KEY", ""); await register();
  expect(calls.initialize).not.toHaveBeenCalled(); expect(calls.inbox).not.toHaveBeenCalled(); expect(calls.notifications).not.toHaveBeenCalled();
  expect(calls.jobs).toHaveBeenCalledOnce(); expect(calls.scheduleJob).toHaveBeenCalledWith("identity:deletions", 60);
});
it("SIGTERM aborts every loop and drains in-flight work", async () => {
  vi.stubEnv("NEXT_MANUAL_SIG_HANDLE", "1");
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  let drain!: () => void;
  calls.inbox.mockImplementation(() => new Promise<void>(resolve => { drain = resolve; }));
  await register();
  const handlers = process.listeners("SIGTERM").filter(fn => !term.has(fn));
  for (const fn of handlers) {
    // Once-wrappers would disappear after the first OS signal, letting a forwarded duplicate kill the drain.
    expect(process.rawListeners("SIGTERM")).toContain(fn);
    fn("SIGTERM"); fn("SIGTERM");
  }
  for (const fn of [calls.inbox, calls.outbox, calls.jobs]) expect(fn.mock.calls[0]![0].signal.aborted).toBe(true);
  let stopped = false; const done = stopWorkers().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false); expect(exit).not.toHaveBeenCalled();
  drain(); await done; expect(stopped).toBe(true); expect(exit).toHaveBeenCalledExactlyOnceWith(143);
});
it("failed initialization never launches partial workers or hides the startup error", async () => {
  calls.initialize.mockRejectedValueOnce(new Error("configuration"));
  await expect(register()).rejects.toThrow("configuration");
  await expect(register()).rejects.toThrow("configuration");
  expect(calls.inbox).not.toHaveBeenCalled(); expect(calls.outbox).not.toHaveBeenCalled(); expect(calls.jobs).not.toHaveBeenCalled();
});
