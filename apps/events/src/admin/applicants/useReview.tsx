"use client";
import { actionCsrf } from "../../auth/client";

import { useState, useTransition, type ReactNode } from "react";
import { Toast, toast } from "@didit-events/ui";
import { decideAction, undoRejectAction } from "../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions";
import { handleSessionExpired, notifySessionExpired } from "../system/session";
import { runBulkApprove } from "./bulkApprove";
import { afterBulk, readAnswer } from "./reviewFlow";
import { useAdminRouter } from "../useAdminRouter";
import { BulkApproveDialog, CapacityDialog, RejectDialog } from "./Dialogs";
import type { ApplicantRow, ApplicantsEvent, Decision, RejectInput } from "./types";
import s from "./Applicants.module.css";

/** `notify` on the capacity dialog is the approve choice the stopped rows were sent with (AP-07), reused by "Approve anyway". */
type Dialog = { kind: "capacity"; rows: ApplicantRow[]; approved: number; capacity: number; notify: boolean } | { kind: "bulk"; rows: ApplicantRow[] } | { kind: "reject"; rows: ApplicantRow[]; initial?: Partial<RejectInput> };

/** Frame gallery: a row drawn busy (AP-01, AP-08) or failed (AP-09). Frames draw dialogs and toasts themselves. */
export interface ReviewFrameState {
  busy?: string;
  errors?: string[];
}

const DONE: Partial<Record<Decision, (name: string, verified: boolean) => string>> = {
  approve: (n, v) => (v ? `Approved ${n} · ticket sent (M-06)` : `Approved ${n} · Didit link on its way (M-03)`),
  waitlist: (n) => `Waitlisted ${n} · M-09 sent`,
  promote: (n) => `Promoted ${n} from the waitlist`,
  remove: (n) => `Removed ${n} from the waitlist`,
  revoke: (n) => `Revoked ${n}’s place`,
  reconsider: (n) => `Approved ${n}`,
  reapprove: (n) => `Re-approved ${n}`,
  resend: (n) => `Sent ${n} a new link`,
};

/**
 * Decisions shared by the list and the drawer: the capacity guard (AP-06), bulk approve with real progress (AP-07,
 * AP-08), per-row failures (AP-09), reject with a reason (AP-10) and the 30 s undo (AP-11). The server decides from
 * its own state; this only renders what it answers.
 */
export function useReview({ eventId, event, frame, onDone, onMoved }: { eventId: string; event: ApplicantsEvent; frame?: ReviewFrameState; onDone?: (ids: string[]) => void; /** Successful decision: the list moves the rows out at once (optimistic), before the refresh lands. */ onMoved?: (ids: string[], decision: Decision) => void }) {
  const router = useAdminRouter();
  const [busy, setBusy] = useState<string | undefined>(frame?.busy);
  const [errors, setErrors] = useState<string[]>(frame?.errors ?? []);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dialogError, setDialogError] = useState<string>();
  // The notify choice the failed rows were approved with, so "Retry all" / "Retry" sends them the same way.
  const [retryNotify, setRetryNotify] = useState(true);
  const [pending, start] = useTransition();

  const finish = (ids: string[], decision: Decision) => {
    setErrors((e) => e.filter((id) => !ids.includes(id)));
    onMoved?.(ids, decision);
    onDone?.(ids);
    router.refresh();
  };

  /** One call; returns false when it did not go through (capacity dialog, over capacity refused, expired session, failure). */
  async function call(decision: Decision, rows: ApplicantRow[], opts: { overCapacity?: boolean; reject?: RejectInput; notify?: boolean } = {}): Promise<boolean> {
    const ids = rows.map((r) => r.id);
    const notify = opts.notify !== false;
    const answer = readAnswer(decision, await decideAction(eventId, decision, ids, { overCapacity: opts.overCapacity, reject: opts.reject, notify }, actionCsrf()));
    switch (answer.kind) {
      case "expired":
        notifySessionExpired();
        return false;
      case "capacity":
        setDialog({ kind: "capacity", rows, approved: answer.approved, capacity: answer.capacity, notify });
        return false;
      case "forbidden":
        setDialog(null);
        toast({ message: answer.message, tone: "danger" });
        return false;
      case "rows-failed":
        setErrors((e) => [...new Set([...e, ...ids])]);
        setRetryNotify(notify);
        return false;
      case "error":
        toast({ message: answer.message, tone: "danger" });
        return false;
    }
    if (decision === "resend" && answer.done === 0) {
      toast({ message: "Nothing to resend: already verified or no longer approved." });
      return false;
    }
    if (answer.failed) toast({ message: `${answer.failed} couldn’t move from their current status. Reload to see the latest.`, tone: "danger" });
    return true;
  }

  const act = (decision: Decision, rows: ApplicantRow[], opts: { overCapacity?: boolean; reject?: RejectInput; notify?: boolean; confirmed?: boolean } = {}) => {
    if (!rows.length) return;
    if (decision === "reject" && !opts.reject) {
      setDialogError(undefined);
      setDialog({ kind: "reject", rows });
      return;
    }
    if (decision === "approve" && rows.length > 1 && !opts.overCapacity && !opts.confirmed) {
      setDialog({ kind: "bulk", rows });
      return;
    }
    start(async () => {
      if (decision === "approve" && rows.length > 1) {
        // AP-08: one request per applicant, so the progress and the failures are real.
        setDialog(null);
        const notify = opts.notify !== false;
        const run = await runBulkApprove(
          rows.map((r) => r.id),
          (id) => decideAction(eventId, "approve", [id], { overCapacity: opts.overCapacity, notify }, actionCsrf()),
          (done, total, id) => {
            setProgress({ done, total });
            setBusy(id);
          },
        );
        setBusy(undefined);
        setProgress(null);
        const screen = afterBulk(run, rows, notify);
        setErrors(screen.errors);
        setRetryNotify(notify);
        if (screen.expired) notifySessionExpired();
        if (screen.capacity) setDialog({ kind: "capacity", ...screen.capacity });
        for (const t of screen.toasts) toast(t);
        // Only the approved ids leave the selection: failed and never-sent rows stay selected.
        if (screen.done.length) onMoved?.(screen.done, "approve");
        onDone?.(screen.done);
        router.refresh();
        return;
      }
      if (rows.length === 1) setBusy(rows[0]!.id);
      const ok = await call(decision, rows, opts);
      setBusy(undefined);
      if (!ok) return;
      setDialog(null);
      const name = rows.length === 1 ? rows[0]!.name : `${rows.length} applicants`;
      if (decision === "reject") {
        const row = rows[0]!;
        toast({
          message: opts.reject?.email ? `Rejected ${name} · email in 30s` : `Rejected ${name}`,
          tone: "info",
          duration: 30_000,
          action:
            rows.length === 1
              ? {
                  label: "Undo",
                  onClick: () =>
                    start(async () => {
                      const r = await undoRejectAction(eventId, row.id, actionCsrf());
                      if (handleSessionExpired(r)) return;
                      toast("error" in r ? { message: r.message ?? "Couldn’t undo. Reload and try again.", tone: "danger" } : { message: `${row.name} is back in ${row.tab}` });
                      router.refresh();
                    }),
                }
              : undefined,
        });
      } else {
        toast({ message: DONE[decision]?.(name, rows.length === 1 && rows[0]!.verified) ?? "Saved" });
      }
      finish(rows.map((r) => r.id), decision);
    });
  };

  const close = () => setDialog(null);
  /** The open dialog. */
  const dialogs = (): ReactNode => {
    const d = dialog;
    if (!d) return null;
    const body =
      d.kind === "capacity" ? (
        <CapacityDialog
          onClose={close}
          names={d.rows.map((r) => r.name)}
          approved={d.approved}
          capacity={d.capacity}
          releaseOn={event.releaseOn}
          pending={pending}
          onWaitlist={() => act("waitlist", d.rows)}
          onApprove={() => act("approve", d.rows, { overCapacity: true, notify: d.notify })}
        />
      ) : d.kind === "bulk" ? (
        <BulkApproveDialog onClose={close} rows={d.rows} approved={event.approved} capacity={event.capacity} onConfirm={(notify) => act("approve", d.rows, { notify, confirmed: true })} />
      ) : (
        <RejectDialog onClose={close} names={d.rows.map((r) => r.name)} initial={d.initial} pending={pending} error={dialogError} onConfirm={(reject) => act("reject", d.rows, { reject })} />
      );
    return body;
  };

  const progressToast: ReactNode = progress ? (
    <div className={s.liveToast}>
      <Toast className={s.toast} tone="progress" message={`Approving ${progress.done} of ${progress.total}… creating Didit links`} />
    </div>
  ) : null;

  const retry = (rows: ApplicantRow[]) => {
    setErrors([]);
    act("approve", rows, { confirmed: true, notify: retryNotify });
  };

  return { busy, errors, retryNotify, pending, act, dialogs, progressToast, retry, dialogOpen: dialog !== null };
}
