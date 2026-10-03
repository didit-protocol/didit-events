// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBulkApprove, type ApproveOneResult } from "./bulkApprove";
import { AI_ERA_APPLICANTS, DESIGN_APPLICANTS } from "./fixtures";
import { SESSION_EXPIRED_EVENT } from "../system/session";

const decideAction = vi.hoisted(() => vi.fn());
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions", () => ({ decideAction, undoRejectAction: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@didit-events/ui", async (orig) => ({ ...(await orig<object>()), toast }));

const { useReview } = await import("./useReview");

const ok = (id: string): ApproveOneResult => ({ ok: true, done: [id], failed: [] });
const full: ApproveOneResult = { error: "capacity", approved: 120, capacity: 120 };
const expired: ApproveOneResult = { error: "session_expired" };
/** Answers from a script: `answers[id]` or ok. */
const server = (answers: Record<string, ApproveOneResult> = {}) => vi.fn(async (id: string) => answers[id] ?? ok(id));

describe("runBulkApprove (AP-08)", () => {
  it("full success: one call per id, all approved, nothing remaining", async () => {
    const approve = server();
    const steps: number[] = [];
    expect(await runBulkApprove(["a", "b", "c"], approve, (done) => steps.push(done))).toEqual({ approved: ["a", "b", "c"], failed: [], remaining: [] });
    expect(approve.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
    expect(steps).toEqual([1, 2, 3]);
  });

  it("stops at capacity: the stopping id and everything after it remain, nothing after it is sent", async () => {
    const approve = server({ c: full });
    expect(await runBulkApprove(["a", "b", "c", "d"], approve)).toEqual({ approved: ["a", "b"], failed: [], stoppedAt: "c", reason: "capacity", remaining: ["c", "d"], capacity: { approved: 120, capacity: 120 } });
    expect(approve).toHaveBeenCalledTimes(3);
  });

  it("stops on an expired session", async () => {
    const approve = server({ b: expired });
    expect(await runBulkApprove(["a", "b", "c"], approve)).toEqual({ approved: ["a"], failed: [], stoppedAt: "b", reason: "expired", remaining: ["b", "c"] });
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it("over capacity refused (forbidden) stops like capacity, with its own reason and the server message", async () => {
    const approve = server({ b: { error: "forbidden", message: "Only owners and admins can approve over capacity." } });
    expect(await runBulkApprove(["a", "b", "c"], approve)).toEqual({ approved: ["a"], failed: [], stoppedAt: "b", reason: "forbidden", message: "Only owners and admins can approve over capacity.", remaining: ["b", "c"] });
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it("per-row failures (AP-09) do not stop the run and are not counted as approved", async () => {
    const approve = server({ a: { error: "conflict" }, b: { ok: true, done: [], failed: ["b"] } });
    expect(await runBulkApprove(["a", "b", "c"], approve)).toEqual({ approved: ["c"], failed: ["a", "b"], remaining: [] });
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ROWS = DESIGN_APPLICANTS.slice(0, 4);
let host: HTMLDivElement;
let root: Root;

/** The list's wiring: the selection drops only what `onDone` reports. */
function Harness({ notify = true }: { notify?: boolean }) {
  const [selected, setSelected] = useState(ROWS.map((r) => r.id));
  const review = useReview({ eventId: "ai-era", event: AI_ERA_APPLICANTS, onDone: (ids) => setSelected((sel) => sel.filter((id) => !ids.includes(id))) });
  return (
    <>
      <button type="button" data-testid="approve" onClick={() => review.act("approve", ROWS, { confirmed: true, notify })} />
      <button type="button" data-testid="retry" onClick={() => review.retry(ROWS.filter((r) => review.errors.includes(r.id)))} />
      <output data-testid="selected">{selected.join(",")}</output>
      <output data-testid="errors">{review.errors.join(",")}</output>
      {review.dialogs()}
    </>
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  decideAction.mockReset();
  toast.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

type Answers = Record<string, ApproveOneResult | ((opts: { overCapacity?: boolean; notify?: boolean }) => ApproveOneResult)>;
const errorsOf = () => host.querySelector("[data-testid=errors]")!.textContent!.split(",").filter(Boolean);
const clickText = async (text: string) => {
  const b = Array.from(document.body.querySelectorAll("button")).find((x) => x.textContent?.trim() === text);
  expect(b, text).toBeDefined();
  await act(async () => b!.click());
};

async function run(answers: Answers, notify = true) {
  decideAction.mockImplementation(async (_e: string, _d: string, [id]: [string], opts: { overCapacity?: boolean; notify?: boolean }) => {
    const a = answers[id];
    return typeof a === "function" ? a(opts) : (a ?? ok(id));
  });
  const router = { refresh: vi.fn(), push: vi.fn() } as unknown as React.ContextType<typeof AppRouterContext>;
  await act(async () =>
    root.render(
      <AppRouterContext.Provider value={router}>
        <Harness notify={notify} />
      </AppRouterContext.Provider>,
    ),
  );
  await act(async () => (host.querySelector("[data-testid=approve]") as HTMLButtonElement).click());
  return { selected: host.querySelector("output")!.textContent!.split(",").filter(Boolean), body: document.body.textContent ?? "" };
}

describe("useReview bulk approve", () => {
  it("full success: the toast reports every approval and the selection clears", async () => {
    const { selected, body } = await run({});
    expect(toast).toHaveBeenCalledWith({ message: "Approved 4 applicants" });
    expect(selected).toEqual([]);
    expect(body).not.toContain("You are at capacity");
    expect(decideAction.mock.calls.every((c) => c[3].notify === true)).toBe(true);
  });

  it("capacity stop: the toast counts only the approved, the rest stay selected, AP-06 opens for them", async () => {
    const { selected, body } = await run({ [ROWS[2]!.id]: full });
    expect(toast).toHaveBeenCalledWith({ message: "Approved 2 applicants" });
    expect(selected).toEqual([ROWS[2]!.id, ROWS[3]!.id]);
    expect(body).toContain("You are at capacity");
    expect(body).toContain("Approving 2 applicants puts you at 122 of 120.");
    expect(decideAction).toHaveBeenCalledTimes(3);
  });

  it("expired session: stops, opens the session modal, keeps the rest selected", async () => {
    const onExpired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    const { selected } = await run({ [ROWS[1]!.id]: expired });
    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ message: "Approved 1 applicant" });
    expect(selected).toEqual(ROWS.slice(1).map((r) => r.id));
  });
});

const FORBIDDEN: ApproveOneResult = { error: "forbidden", message: "Only owners and admins can approve over capacity." };
/** At capacity unless sent with `overCapacity`, then `over`. */
const capacityThen = (over: ApproveOneResult) => (opts: { overCapacity?: boolean }) => (opts.overCapacity ? over : full);

describe("useReview over capacity and the notify choice", () => {
  it("staff: Approve anyway answered forbidden stops at once, closes AP-06, toasts the message, no Didit failure", async () => {
    const [, , c, d] = ROWS.map((r) => r.id);
    await run({ [c!]: capacityThen(FORBIDDEN), [d!]: capacityThen(FORBIDDEN) });
    expect(document.body.textContent).toContain("You are at capacity");
    decideAction.mockClear();
    toast.mockClear();
    await clickText("Approve anyway");
    // One request, the first stopped row; nothing after it is sent.
    expect(decideAction).toHaveBeenCalledTimes(1);
    expect(decideAction.mock.calls[0]![2]).toEqual([c]);
    expect(document.body.textContent).not.toContain("You are at capacity");
    expect(toast).toHaveBeenCalledWith({ message: "Only owners and admins can approve over capacity.", tone: "danger" });
    expect(errorsOf()).toEqual([]);
    expect(host.querySelector("output")!.textContent).toBe([c, d].join(","));
  });

  it("single row: forbidden closes the dialog and toasts, the row is not drawn failed", async () => {
    const row = ROWS[0]!;
    decideAction.mockImplementation(async (_e: string, _d: string, _ids: string[], opts: { overCapacity?: boolean }) => (opts.overCapacity ? FORBIDDEN : full));
    function One() {
      const review = useReview({ eventId: "ai-era", event: AI_ERA_APPLICANTS });
      return (
        <>
          <button type="button" data-testid="one" onClick={() => review.act("approve", [row])} />
          <output data-testid="errors">{review.errors.join(",")}</output>
          {review.dialogs()}
        </>
      );
    }
    const router = { refresh: vi.fn(), push: vi.fn() } as unknown as React.ContextType<typeof AppRouterContext>;
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={router}>
          <One />
        </AppRouterContext.Provider>,
      ),
    );
    await act(async () => (host.querySelector("[data-testid=one]") as HTMLButtonElement).click());
    expect(document.body.textContent).toContain("You are at capacity");
    await clickText("Approve anyway");
    expect(decideAction).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("You are at capacity");
    expect(toast).toHaveBeenCalledWith({ message: "Only owners and admins can approve over capacity.", tone: "danger" });
    expect(errorsOf()).toEqual([]);
  });

  it("notify:false is kept across a capacity stop, Approve anyway and Retry all", async () => {
    const [, , c, d] = ROWS.map((r) => r.id);
    const failOnce = vi.fn((opts: { overCapacity?: boolean }) => (opts.overCapacity ? { error: "conflict" } : full));
    await run({ [c!]: capacityThen(ok(c!)), [d!]: failOnce }, false);
    expect(document.body.textContent).toContain("You are at capacity");
    await clickText("Approve anyway");
    expect(errorsOf()).toEqual([d]);
    decideAction.mockImplementation(async (_e: string, _d: string, [id]: [string]) => ok(id));
    await act(async () => (host.querySelector("[data-testid=retry]") as HTMLButtonElement).click());
    expect(errorsOf()).toEqual([]);
    // Every call of the whole flow went out silently: first run, Approve anyway, Retry all.
    const notifies = decideAction.mock.calls.map((call) => call[3].notify);
    expect(notifies.length).toBeGreaterThanOrEqual(6);
    expect(new Set(notifies)).toEqual(new Set([false]));
  });
});
