"use client";

import { Toast } from "@didit-events/ui";
import { BulkApproveDialog, CapacityDialog, FrameScrim, RejectDialog } from "./Dialogs";
import type { RejectInput } from "./types";
import s from "./Applicants.module.css";

// Frame-gallery twins of the review overlays (static, no handlers): the server-rendered frames can't pass functions.
const noop = () => {};

export function CapacityFrame({ names, approved, capacity, releaseOn }: { names: string[]; approved: number; capacity: number; releaseOn: string }) {
  return (
    <FrameScrim>
      <CapacityDialog inline onClose={noop} names={names} approved={approved} capacity={capacity} releaseOn={releaseOn} onWaitlist={noop} onApprove={noop} />
    </FrameScrim>
  );
}

export function BulkApproveFrame({ rows, approved, capacity }: { rows: { verified: boolean }[]; approved: number; capacity: number }) {
  return (
    <FrameScrim>
      <BulkApproveDialog inline onClose={noop} rows={rows} approved={approved} capacity={capacity} onConfirm={noop} />
    </FrameScrim>
  );
}

export function RejectFrame({ names, initial }: { names: string[]; initial?: Partial<RejectInput> }) {
  return (
    <FrameScrim>
      <RejectDialog inline onClose={noop} names={names} initial={initial} onConfirm={noop} />
    </FrameScrim>
  );
}

export function ToastFrame({ tone, message, action }: { tone: "progress" | "info"; message: string; action?: string }) {
  return (
    <div className={s.frameToast}>
      <Toast className={s.toast} tone={tone} message={message} action={action ? { label: action, onClick: noop } : undefined} />
    </div>
  );
}
