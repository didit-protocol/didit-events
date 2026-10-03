// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkApproveResult } from "./bulkApprove";
import { AI_ERA_APPLICANTS, APPROVED_ROWS, DESIGN_APPLICANTS, detailForRow } from "./fixtures";
import { parseApplicantQuery, type ReviewKey } from "./query";
import { afterBulk, keyIntent, modalOpen, moveCursor, readAnswer, type KeyContext } from "./reviewFlow";
import type { ApplicantRow, ApplicantsEvent } from "./types";

const decideAction = vi.hoisted(() => vi.fn());
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions", () => ({ decideAction, undoRejectAction: vi.fn(), reopenRequestsAction: vi.fn(), saveNoteAction: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@didit-events/ui", async (orig) => ({ ...(await orig<object>()), toast }));

const { ApplicantsReview } = await import("./ApplicantsReview");
const { ApplicantDrawer } = await import("./ApplicantDrawer");

const PENDING = DESIGN_APPLICANTS.slice(0, 4);
const APPROVED = APPROVED_ROWS[0]!;
const FORBIDDEN = "Only owners and admins can approve over capacity.";

describe("readAnswer", () => {
  it.each([
    ["expired session", "approve", { error: "session_expired" }, { kind: "expired" }],
    ["capacity", "approve", { error: "capacity", approved: 120, capacity: 120 }, { kind: "capacity", approved: 120, capacity: 120 }],
    ["forbidden with message", "approve", { error: "forbidden", message: FORBIDDEN }, { kind: "forbidden", message: FORBIDDEN }],
    ["forbidden without message", "promote", { error: "forbidden" }, { kind: "forbidden", message: FORBIDDEN }],
    ["approve failure is a row failure", "approve", { error: "conflict" }, { kind: "rows-failed" }],
    ["promote failure is a row failure", "promote", { error: "not_found" }, { kind: "rows-failed" }],
    ["other failure is a toast", "waitlist", { error: "conflict", message: "Nope" }, { kind: "error", message: "Nope" }],
    ["other failure, default message", "reject", { error: "invalid" }, { kind: "error", message: "Couldn’t save that decision. Try again." }],
    ["ok", "approve", { ok: true, done: ["a"], failed: ["b"] }, { kind: "ok", done: 1, failed: 1, skipped: 0 }],
    ["resend with skipped", "resend", { ok: true, done: [], failed: [], skipped: [{ id: "a", reason: "verified" }] }, { kind: "ok", done: 0, failed: 0, skipped: 1 }],
  ] as const)("%s", (_, decision, result, expected) => {
    expect(readAnswer(decision, result)).toEqual(expected);
  });
});

describe("afterBulk", () => {
  const run = (r: Partial<BulkApproveResult>): BulkApproveResult => ({ approved: [], failed: [], remaining: [], ...r });
  const [a, b, c, d] = PENDING.map((r) => r.id) as [string, string, string, string];

  it.each([
    ["all approved", run({ approved: [a, b] }), true, { errors: [], capacity: undefined, toasts: [{ message: "Approved 2 applicants" }], expired: false, done: [a, b] }],
    ["row failures", run({ approved: [a], failed: [b] }), true, { errors: [b], capacity: undefined, toasts: [{ message: "Approved 1 applicant" }], expired: false, done: [a] }],
    [
      "capacity stop keeps the notify choice",
      run({ approved: [a], stoppedAt: c, reason: "capacity", remaining: [c, d], capacity: { approved: 119, capacity: 120 } }),
      false,
      { errors: [], capacity: { rows: [PENDING[2], PENDING[3]], approved: 119, capacity: 120, notify: false }, toasts: [{ message: "Approved 1 applicant" }], expired: false, done: [a] },
    ],
    ["forbidden stop: toast, no dialog, no failures", run({ stoppedAt: a, reason: "forbidden", message: FORBIDDEN, remaining: [a, b] }), true, { errors: [], capacity: undefined, toasts: [{ message: FORBIDDEN, tone: "danger" }], expired: false, done: [] }],
    ["expired stop", run({ approved: [a], stoppedAt: b, reason: "expired", remaining: [b] }), true, { errors: [], capacity: undefined, toasts: [{ message: "Approved 1 applicant" }], expired: true, done: [a] }],
  ] as const)("%s", (_, result, notify, expected) => {
    expect(afterBulk(result, PENDING, notify)).toEqual(expected);
  });
});

describe("keyIntent", () => {
  const pending = PENDING[0]!;
  const ctx = (c: Partial<KeyContext> = {}): KeyContext => ({ row: pending, registration: "open", blocked: false, ...c });
  it.each<[string, ReviewKey | null, KeyContext, ReturnType<typeof keyIntent>]>([
    ["J moves down", "next", ctx({ row: undefined }), { kind: "move", dir: 1 }],
    ["K moves up", "prev", ctx(), { kind: "move", dir: -1 }],
    ["A approves a pending row", "approve", ctx(), { kind: "decide", decision: "approve", row: pending }],
    ["W waitlists", "waitlist", ctx(), { kind: "decide", decision: "waitlist", row: pending }],
    ["R rejects", "reject", ctx(), { kind: "decide", decision: "reject", row: pending }],
    ["A on a full event does nothing", "approve", ctx({ registration: "full" }), null],
    ["W on a full event still waitlists", "waitlist", ctx({ registration: "full" }), { kind: "decide", decision: "waitlist", row: pending }],
    ["A with no cursor row does nothing", "approve", ctx({ row: undefined }), null],
    ["A on an approved row does nothing", "approve", ctx({ row: APPROVED }), null],
    ["A while busy does nothing", "approve", ctx({ busy: true }), null],
    ["J while a dialog is open does nothing", "next", ctx({ blocked: true }), null],
    ["A while a dialog is open does nothing", "approve", ctx({ blocked: true }), null],
    ["no key", null, ctx(), null],
  ])("%s", (_, k, c, expected) => {
    expect(keyIntent(k, c)).toEqual(expected);
  });
});

describe("moveCursor", () => {
  const ids = ["a", "b", "c"];
  it.each<[string, readonly string[], string | undefined, 1 | -1, string | undefined]>([
    ["no cursor, J → first", ids, undefined, 1, "a"],
    ["no cursor, K → first", ids, undefined, -1, "a"],
    ["down", ids, "a", 1, "b"],
    ["up", ids, "b", -1, "a"],
    ["clamped at the end", ids, "c", 1, "c"],
    ["clamped at the start", ids, "a", -1, "a"],
    ["cursor left the list → first", ids, "gone", 1, "a"],
    ["empty list", [], "a", 1, undefined],
  ])("%s", (_, list, current, dir, expected) => {
    expect(moveCursor(list, current, dir)).toBe(expected);
  });
});

describe("modalOpen", () => {
  it("counts every aria-modal except the caller's own", () => {
    const root = document.createElement("div");
    expect(modalOpen(root)).toBe(false);
    const own = document.createElement("aside");
    own.setAttribute("aria-modal", "true");
    root.appendChild(own);
    expect(modalOpen(root)).toBe(true);
    expect(modalOpen(root, own)).toBe(false);
    const other = document.createElement("div");
    other.setAttribute("aria-modal", "true");
    root.appendChild(other);
    expect(modalOpen(root, own)).toBe(true);
  });
});

/* ── Mounted keyboard review ───────────────────────────────────── */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() };
const Q = parseApplicantQuery({});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  decideAction.mockReset();
  decideAction.mockImplementation(async (_e: string, _d: string, ids: string[]) => ({ ok: true, done: ids, failed: [] }));
  toast.mockReset();
  router.push.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("[data-test-modal]").forEach((m) => m.remove());
});

const press = async (key: string) => act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const cursorRow = () => host.querySelector("[data-cursor]")?.getAttribute("data-index");
const decided = () => decideAction.mock.calls.map((c) => [c[1], c[2]]);

function List({ rows = PENDING, event = AI_ERA_APPLICANTS }: { rows?: ApplicantRow[]; event?: ApplicantsEvent }) {
  return <ApplicantsReview eventId="ai-era" query={Q} rows={rows} event={event} pendingCount={rows.length} toolbar={null} />;
}
function Drawer({ row, event = AI_ERA_APPLICANTS }: { row: ApplicantRow; event?: ApplicantsEvent }) {
  return <ApplicantDrawer eventId="ai-era" detail={{ ...detailForRow(row), tab: row.tab }} row={row} event={event} index={2} total={4} prevHref="/prev" nextHref="/next" closeHref="/close" />;
}
async function mount(node: React.ReactNode) {
  await act(async () => root.render(<AppRouterContext.Provider value={router as unknown as React.ContextType<typeof AppRouterContext>}>{node}</AppRouterContext.Provider>));
}

describe("ApplicantsReview keyboard", () => {
  it("J/K move the cursor, clamped", async () => {
    await mount(<List />);
    expect(cursorRow()).toBeUndefined();
    await press("j");
    expect(cursorRow()).toBe("0");
    await press("J");
    await press("j");
    expect(cursorRow()).toBe("2");
    await press("k");
    expect(cursorRow()).toBe("1");
    await press("k");
    await press("k");
    expect(cursorRow()).toBe("0");
  });

  it("A approves only the focused pending row", async () => {
    await mount(<List />);
    await press("a");
    expect(decideAction).not.toHaveBeenCalled();
    await press("j");
    await press("j");
    await press("a");
    expect(decided()).toEqual([["approve", [PENDING[1]!.id]]]);
  });

  it("the cursor follows the applicant when the list changes under it", async () => {
    await mount(<List />);
    await press("j");
    await press("j");
    await mount(<List rows={[PENDING[3]!, PENDING[1]!, PENDING[0]!]} />);
    await press("a");
    expect(decided()).toEqual([["approve", [PENDING[1]!.id]]]);
  });

  it("A does nothing on a non-pending row", async () => {
    await mount(<List rows={[APPROVED]} />);
    await press("j");
    await press("a");
    expect(decideAction).not.toHaveBeenCalled();
  });

  it("no A when the event is full (W still works)", async () => {
    await mount(<List event={{ ...AI_ERA_APPLICANTS, registration: "full" }} />);
    await press("j");
    await press("a");
    expect(decideAction).not.toHaveBeenCalled();
    await press("w");
    expect(decided()).toEqual([["waitlist", [PENDING[0]!.id]]]);
  });

  it("no action while any aria-modal dialog is open", async () => {
    await mount(<List />);
    await press("j");
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("data-test-modal", "");
    document.body.appendChild(modal);
    await press("j");
    expect(cursorRow()).toBe("0");
    await press("a");
    expect(decideAction).not.toHaveBeenCalled();
  });

  it("R opens the reject dialog; A is ignored while it is open", async () => {
    await mount(<List />);
    await press("j");
    await press("r");
    expect(document.body.querySelector('[aria-modal="true"]')).not.toBeNull();
    await press("a");
    await press("j");
    expect(decideAction).not.toHaveBeenCalled();
    expect(cursorRow()).toBe("0");
  });
});

describe("ApplicantDrawer keyboard", () => {
  it("J/K go to the next / previous applicant", async () => {
    await mount(<Drawer row={PENDING[1]!} />);
    await press("j");
    expect(router.push).toHaveBeenLastCalledWith("/next", { scroll: false });
    await press("k");
    expect(router.push).toHaveBeenLastCalledWith("/prev", { scroll: false });
  });

  it("A acts only on the drawer row, never on the list cursor behind it", async () => {
    await mount(<List />);
    await press("j");
    expect(cursorRow()).toBe("0");
    await mount(
      <>
        <List />
        <Drawer row={PENDING[2]!} />
      </>,
    );
    await press("a");
    expect(decided()).toEqual([["approve", [PENDING[2]!.id]]]);
  });

  it("no A when the event is full", async () => {
    await mount(<Drawer row={PENDING[0]!} event={{ ...AI_ERA_APPLICANTS, registration: "full" }} />);
    await press("a");
    expect(decideAction).not.toHaveBeenCalled();
  });

  it("no A on a row that is not pending", async () => {
    await mount(<Drawer row={APPROVED} />);
    await press("a");
    expect(decideAction).not.toHaveBeenCalled();
  });

  it("no action while a dialog is open over the drawer", async () => {
    await mount(<Drawer row={PENDING[0]!} />);
    await press("r");
    expect(document.body.querySelectorAll('[aria-modal="true"]').length).toBe(2);
    await press("a");
    await press("j");
    expect(decideAction).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
