// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_ERA_APPLICANTS, DESIGN_APPLICANTS, DESIGN_COUNTS } from "./fixtures";
import { parseApplicantQuery } from "./query";
import { applyMoves, NO_MOVES, recordMoves } from "./reviewFlow";

const decideAction = vi.hoisted(() => vi.fn());
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions", () => ({ decideAction, undoRejectAction: vi.fn(), reopenRequestsAction: vi.fn(), saveNoteAction: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@didit-events/ui", async (orig) => ({ ...(await orig<object>()), toast }));

const { ApplicantsView } = await import("./ApplicantsView");

const PENDING = DESIGN_APPLICANTS.slice(0, 4);
const COUNTS = { ...DESIGN_COUNTS, pending: PENDING.length };

describe("optimistic moves (pure)", () => {
  it("an approved row leaves Pending and the counts move to Approved", () => {
    const moves = recordMoves(NO_MOVES, PENDING, [PENDING[1]!.id], "approve");
    const view = applyMoves(PENDING, COUNTS, moves);
    expect(view.rows!.map((r) => r.id)).toEqual([PENDING[0]!.id, PENDING[2]!.id, PENDING[3]!.id]);
    expect(view.counts).toEqual({ ...COUNTS, pending: 3, approved: COUNTS.approved + 1 });
  });

  it("waitlist and reject land in their tabs; resend moves nothing", () => {
    let moves = recordMoves(NO_MOVES, PENDING, [PENDING[0]!.id], "waitlist");
    moves = recordMoves(moves, PENDING, [PENDING[2]!.id], "reject");
    moves = recordMoves(moves, PENDING, [PENDING[3]!.id], "resend");
    const view = applyMoves(PENDING, COUNTS, moves);
    expect(view.rows!.map((r) => r.id)).toEqual([PENDING[1]!.id, PENDING[3]!.id]);
    expect(view.counts).toEqual({ ...COUNTS, pending: 2, waitlist: COUNTS.waitlist + 1, rejected: COUNTS.rejected + 1 });
  });

  it("refreshed server rows (a new array) replace the overlay instead of counting twice", () => {
    const moves = recordMoves(NO_MOVES, PENDING, [PENDING[1]!.id], "approve");
    const refreshed = PENDING.filter((r) => r.id !== PENDING[1]!.id);
    const counts = { ...COUNTS, pending: 3, approved: COUNTS.approved + 1 };
    expect(applyMoves(refreshed, counts, moves)).toEqual({ rows: refreshed, counts });
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() };

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  decideAction.mockReset();
  router.refresh.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const segCount = (label: string) => [...host.querySelectorAll("a")].find((a) => a.textContent?.startsWith(`${label} `))?.textContent?.replace(`${label} `, "");
const rowNames = () => [...host.querySelectorAll('[role="row"]')].slice(1).map((r) => r.textContent);

describe("ApplicantsView row decision", () => {
  it("after Approve succeeds the row leaves Pending at once, the counts update and the route refreshes", async () => {
    decideAction.mockImplementation(async (_e: string, _d: string, ids: string[]) => ({ ok: true, done: ids, failed: [] }));
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={router as unknown as React.ContextType<typeof AppRouterContext>}>
          <ApplicantsView eventId="ai-era" query={parseApplicantQuery({})} counts={COUNTS} rows={PENDING} event={AI_ERA_APPLICANTS} />
        </AppRouterContext.Provider>,
      ),
    );
    const target = PENDING[1]!;
    expect(rowNames().some((t) => t?.includes(target.name))).toBe(true);
    const approve = host.querySelector<HTMLButtonElement>(`button[aria-label="Approve ${target.name}"]`)!;
    await act(async () => approve.click());
    expect(decideAction.mock.calls.map((c) => [c[1], c[2]])).toEqual([["approve", [target.id]]]);
    expect(rowNames().some((t) => t?.includes(target.name))).toBe(false);
    expect(rowNames()).toHaveLength(PENDING.length - 1);
    expect(segCount("Pending")).toBe(String(PENDING.length - 1));
    expect(segCount("Approved")).toBe(String(COUNTS.approved + 1));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("a failed approve keeps the row and the counts", async () => {
    decideAction.mockResolvedValue({ error: "conflict", message: "no" });
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={router as unknown as React.ContextType<typeof AppRouterContext>}>
          <ApplicantsView eventId="ai-era" query={parseApplicantQuery({})} counts={COUNTS} rows={PENDING} event={AI_ERA_APPLICANTS} />
        </AppRouterContext.Provider>,
      ),
    );
    await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="Approve ${PENDING[1]!.name}"]`)!.click());
    expect(rowNames()).toHaveLength(PENDING.length);
    expect(segCount("Pending")).toBe(String(PENDING.length));
  });
});
