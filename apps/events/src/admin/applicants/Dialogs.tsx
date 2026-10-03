"use client";

import { useId, useState, type ReactNode } from "react";
import { Banner, Button, Modal, Select, Textarea, Switch } from "@didit-events/ui";
import { bulkApproveBody, capacityBody } from "./present";
import { REJECT_REASONS, type RejectInput, type RejectReason } from "./types";
import s from "./Applicants.module.css";

/** A toggle card of the 05 modals: label + hint on #F8F8F8, radius 12, the C-00 switch on the right. */
export function ToggleRow({ label, hint, checked, onChange, locked }: { label: string; hint: string; checked: boolean; onChange?: (v: boolean) => void; locked?: boolean }) {
  const id = useId();
  return (
    <label className={locked ? `${s.toggleRow} ${s.locked}` : s.toggleRow} htmlFor={id}>
      <span className={s.toggleText}>
        <b>{label}</b>
        <span id={`${id}-h`}>{hint}</span>
      </span>
      <Switch id={id} checked={checked} disabled={locked} aria-describedby={`${id}-h`} onChange={(e) => onChange?.(e.currentTarget.checked)} />
    </label>
  );
}

interface DialogBase {
  inline?: boolean;
  onClose: () => void;
}

/** Frame wrapper: the 24% scrim over the whole 1440×960 frame with the modal centred. */
export function FrameScrim({ children }: { children: ReactNode }) {
  return <div className={s.scrim}>{children}</div>;
}

/** AP-06 Approve over capacity. */
export function CapacityDialog({ inline, onClose, names, approved, capacity, releaseOn, pending, onWaitlist, onApprove }: DialogBase & { names: string[]; approved: number; capacity: number; releaseOn: string; pending?: boolean; onWaitlist: () => void; onApprove: () => void }) {
  return (
    <Modal
      open
      inline={inline}
      onClose={onClose}
      title="You are at capacity"
      closeLabel="Close"
      width={480}
      className={s.modal}
      description={capacityBody(names, approved, capacity, releaseOn)}
      footer={
        <>
          <Button variant="secondary" onClick={onWaitlist} disabled={pending} data-autofocus="">
            Waitlist instead
          </Button>
          <Button onClick={onApprove} loading={pending}>
            Approve anyway
          </Button>
        </>
      }
    >
      <Banner tone="info" className={s.modalBanner}>
        Tip: waitlist instead and we promote in order when places open.
      </Banner>
    </Modal>
  );
}

/** AP-07 Bulk approve confirm. */
export function BulkApproveDialog({ inline, onClose, rows, approved, capacity, onConfirm }: DialogBase & { rows: { verified: boolean }[]; approved: number; capacity: number; onConfirm: (notify: boolean) => void }) {
  const [notify, setNotify] = useState(true);
  const n = rows.length;
  return (
    <Modal
      open
      inline={inline}
      onClose={onClose}
      title={`Approve ${n} applicant${n === 1 ? "" : "s"}?`}
      closeLabel="Close"
      width={480}
      className={s.modal}
      description={bulkApproveBody(rows)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-autofocus="">
            Cancel
          </Button>
          <Button onClick={() => onConfirm(notify)}>Approve {n}</Button>
        </>
      }
    >
      <dl className={s.summary}>
        <div>
          <dt>Places left after</dt>
          <dd>
            {Math.max(0, capacity - approved - n)} of {capacity}
          </dd>
        </div>
        <div>
          <dt>Emails sent</dt>
          <dd>{notify ? n : 0}</dd>
        </div>
      </dl>
      <ToggleRow label="Send emails now" hint="Turn off to approve silently and send later" checked={notify} onChange={setNotify} />
    </Modal>
  );
}

export interface RejectDialogProps extends DialogBase {
  names: string[];
  /** Frame gallery / reopened dialog: prefilled values. */
  initial?: Partial<RejectInput>;
  /** Start with the "pick a reason" error shown (a submit without a reason). */
  initialInvalid?: boolean;
  pending?: boolean;
  /** Server error to show under the form. */
  error?: string;
  onConfirm: (input: RejectInput) => void;
}

/** AP-10 Reject with an internal reason, an optional note for the email, and the M-10 / block toggles. */
export function RejectDialog({ inline, onClose, names, initial, initialInvalid, pending, error, onConfirm }: RejectDialogProps) {
  const [reason, setReason] = useState<RejectReason | "">(initial?.reason ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [email, setEmail] = useState(initial?.email ?? true);
  const [block, setBlock] = useState(initial?.block ?? false);
  const [invalid, setInvalid] = useState(initialInvalid ?? false);
  const title = names.length === 1 ? `Reject ${names[0]}?` : `Reject ${names.length} applicants?`;
  const submit = () => {
    if (!reason) {
      setInvalid(true);
      return;
    }
    onConfirm({ reason, note: note.trim(), email, block });
  };
  return (
    <Modal
      open
      inline={inline}
      onClose={onClose}
      title={title}
      closeLabel="Close"
      width={520}
      className={s.modal}
      description="The reason stays internal. The applicant gets a kind, generic message unless you turn it off."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending} data-autofocus="">
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} loading={pending}>
            Reject
          </Button>
        </>
      }
    >
      <Select
        label="Reason (internal)"
        className={s.select}
        value={reason}
        placeholder="Pick a reason"
        onChange={(e) => {
          setReason(e.currentTarget.value as RejectReason);
          setInvalid(false);
        }}
        options={REJECT_REASONS.map((r) => ({ value: r, label: r }))}
        hint={invalid ? undefined : "Options: At capacity · Not a fit · Duplicate · Incomplete answers · Other"}
        error={invalid ? "Pick a reason. Staff see it in the Rejected tab." : undefined}
      />
      <Textarea label="Personal note (optional, included in email)" className={s.textarea} placeholder="Add a line to the email…" value={note} maxLength={500} rows={3} disabled={!email} onChange={(e) => setNote(e.currentTarget.value)} />
      <ToggleRow label="Email the applicant (M-10)" hint="Off: they see “Not approved” on the event page only" checked={email} onChange={setEmail} />
      <ToggleRow label="Block future requests" hint="For spam or abuse only" checked={block} onChange={setBlock} />
      {error ? (
        <p role="alert" className={s.fieldError}>
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
