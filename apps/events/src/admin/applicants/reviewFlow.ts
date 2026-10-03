/**
 * The review flow as pure functions (no React, no server): how one decision answer is read, what a finished bulk run
 * leaves on screen, and what a review key does. `useReview`, `ApplicantsReview` and `ApplicantDrawer` only apply
 * what these return, so every sequence is table-tested.
 */
import { isSessionExpired } from "../system/session";
import { FORBIDDEN_MESSAGE, type BulkApproveResult } from "./bulkApprove";
import type { ReviewKey } from "./query";
import type { ApplicantCounts, ApplicantRow, ApplicantsEvent, ApplicantTab, Decision } from "./types";

/* ── One decision answer ───────────────────────────────────────── */

export type Answer =
  | { kind: "ok"; failed: number; skipped: number; done: number }
  | { kind: "expired" }
  /** AP-06: open the capacity dialog with the stored numbers. */
  | { kind: "capacity"; approved: number; capacity: number }
  /** Over capacity refused (staff): close the dialog, toast the message, never a Didit failure. */
  | { kind: "forbidden"; message: string }
  /** AP-09: the rows are drawn failed ("Couldn’t create Didit link") and can be retried. */
  | { kind: "rows-failed" }
  | { kind: "error"; message: string };

type DecideAnswer = { ok: true; done: readonly string[]; failed: readonly string[]; skipped?: readonly unknown[] } | { error: string; message?: string; approved?: number; capacity?: number };

export function readAnswer(decision: Decision, result: DecideAnswer): Answer {
  if (isSessionExpired(result)) return { kind: "expired" };
  if ("error" in result) {
    if (result.error === "capacity" && typeof result.capacity === "number") return { kind: "capacity", approved: result.approved ?? 0, capacity: result.capacity };
    if (result.error === "forbidden") return { kind: "forbidden", message: result.message ?? FORBIDDEN_MESSAGE };
    if (decision === "approve" || decision === "promote") return { kind: "rows-failed" };
    return { kind: "error", message: result.message ?? "Couldn’t save that decision. Try again." };
  }
  return { kind: "ok", done: result.done.length, failed: result.failed.length, skipped: result.skipped?.length ?? 0 };
}

/* ── After a bulk approve run ──────────────────────────────────── */

export interface ToastSpec {
  message: string;
  tone?: "danger";
}

export interface BulkScreen {
  /** Rows drawn failed (AP-09). */
  errors: string[];
  /** AP-06 for the rows never sent, with the notify choice they were sent with. */
  capacity?: { rows: ApplicantRow[]; approved: number; capacity: number; notify: boolean };
  toasts: ToastSpec[];
  expired: boolean;
  /** Ids that leave the selection: only the approved ones. */
  done: string[];
}

export function afterBulk(run: BulkApproveResult, rows: readonly ApplicantRow[], notify: boolean): BulkScreen {
  const toasts: ToastSpec[] = [];
  if (run.reason === "forbidden") toasts.push({ message: run.message ?? FORBIDDEN_MESSAGE, tone: "danger" });
  if (run.approved.length) toasts.push({ message: `Approved ${run.approved.length} applicant${run.approved.length === 1 ? "" : "s"}` });
  return {
    errors: run.failed,
    capacity: run.reason === "capacity" && run.capacity ? { rows: rows.filter((r) => run.remaining.includes(r.id)), ...run.capacity, notify } : undefined,
    toasts,
    expired: run.reason === "expired",
    done: run.approved,
  };
}

/* ── Optimistic moves after a decision ─────────────────────────── */

/** Where a decided row lands; `null` = it leaves its tab for one the list does not predict (the refresh settles it). */
const MOVES_TO: Record<Decision, ApplicantTab | null | undefined> = {
  approve: "approved",
  waitlist: "waitlist",
  reject: "rejected",
  promote: "approved",
  reconsider: "approved",
  reapprove: "approved",
  remove: null,
  revoke: null,
  resend: undefined,
};

/**
 * Rows decided since the server rows `base` were rendered. Applied only over that same `base`: the refreshed rows
 * (a new array) already carry the move, so the overlay drops itself instead of counting twice.
 */
export interface Moves {
  base: readonly ApplicantRow[] | null;
  to: Record<string, ApplicantTab | null>;
}

export const NO_MOVES: Moves = { base: null, to: {} };

/** Records a successful decision on `ids` (resend moves nothing). */
export function recordMoves(prev: Moves, rows: readonly ApplicantRow[] | null, ids: readonly string[], decision: Decision): Moves {
  const target = MOVES_TO[decision];
  if (target === undefined || !rows) return prev;
  const to = prev.base === rows ? { ...prev.to } : {};
  for (const id of ids) to[id] = target;
  return { base: rows, to };
}

/** The list and the segment counts with the recorded moves applied: moved rows leave the current tab at once. */
export function applyMoves(rows: ApplicantRow[] | null, counts: ApplicantCounts, moves: Moves): { rows: ApplicantRow[] | null; counts: ApplicantCounts } {
  if (!rows || moves.base !== rows) return { rows, counts };
  const next = { ...counts };
  const kept: ApplicantRow[] = [];
  for (const r of rows) {
    const to = moves.to[r.id];
    if (to === undefined || to === r.tab) {
      kept.push(r);
      continue;
    }
    next[r.tab] = Math.max(0, next[r.tab] - 1);
    if (to) next[to] += 1;
  }
  return { rows: kept, counts: next };
}

/* ── Keyboard review (AP-03 note) ──────────────────────────────── */

export type KeyIntent = { kind: "move"; dir: 1 | -1 } | { kind: "decide"; decision: "approve" | "waitlist" | "reject"; row: ApplicantRow };

export interface KeyContext {
  /** The row the keys act on: the list's cursor row, or the drawer's row. */
  row?: ApplicantRow;
  registration: ApplicantsEvent["registration"];
  /** A dialog is open (aria-modal) over this surface. */
  blocked: boolean;
  /** A decision is still in flight. */
  busy?: boolean;
}

/** J/K move; A/W/R decide on a pending row only; A never on a full event; nothing while a dialog is open. */
export function keyIntent(k: ReviewKey | null, ctx: KeyContext): KeyIntent | null {
  if (!k || ctx.blocked) return null;
  if (k === "next" || k === "prev") return { kind: "move", dir: k === "next" ? 1 : -1 };
  const row = ctx.row;
  if (!row || row.tab !== "pending" || ctx.busy) return null;
  if (k === "approve" && ctx.registration === "full") return null;
  return { kind: "decide", decision: k, row };
}

/** The next cursor id: the first row when there is no cursor (or it left the list), clamped at both ends. */
export function moveCursor(ids: readonly string[], current: string | undefined, dir: 1 | -1): string | undefined {
  if (!ids.length) return undefined;
  const i = current === undefined ? -1 : ids.indexOf(current);
  if (i < 0) return ids[0];
  return ids[Math.min(ids.length - 1, Math.max(0, i + dir))];
}

/** Any open aria-modal dialog other than `own` (the drawer is itself a modal and must not block its own keys). */
export function modalOpen(root: ParentNode, own?: Element | null): boolean {
  return Array.from(root.querySelectorAll('[aria-modal="true"]')).some((m) => m !== own);
}
