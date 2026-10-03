"use client";
import { actionCsrf } from "../../auth/client";

import { useState, useTransition } from "react";
import { Button, ConfirmDialog, CopyField, Drawer, Modal, Skeleton, StatusPill, Textarea, Toast, cx, toast } from "@didit-events/ui";
import { PersonAvatar, PersonSections, PersonSubtitle, PersonSubtitlePreview, PersonTitle } from "../person/PersonPanel";
import type { PersonSummary } from "../person/types";
import { useAdminRouter } from "../useAdminRouter";
import { bulkGuestsAction, manualCheckInAction, resolveEmailMismatchAction, undoCheckInAction } from "../../../app/admin/(events)/events/[id]/(tabs)/guests/actions";
import { handleSessionExpired } from "../system/session";
import { canSendLink } from "./checkin";
import type { GuestDetail, GuestStatus } from "./types";
import s from "./Drawer.module.css";

type Dialog = "checkin" | "undo" | "revoke";

/** What the list row already knows about a guest: the drawer's header while the detail loads. */
export interface GuestPreview {
  id: string;
  name: string;
  email: string;
  status?: GuestStatus;
  person?: PersonSummary;
}

export interface GuestDrawerProps {
  eventId: string;
  /** Null while loading (A-06a): the header shows `preview` when there is one, and only the sections wait. */
  detail: GuestDetail | null;
  preview?: GuestPreview | null;
  /** False while the drawer closes (it stays mounted to slide out). */
  open?: boolean;
  /** Moves the URL (close). The host keeps the drawer mounted; without one it is a page navigation. */
  go?: (href: string) => void;
  /** An action answered with the guest's new detail: the host keeps it. */
  onDetail?: (detail: GuestDetail) => void;
  /** The detail could not be loaded; `onRetry` asks again. */
  loadError?: boolean;
  onRetry?: () => void;
  /** Where "close" goes (the list with its filters). */
  closeHref: string;
  dialog?: Dialog;
  /** Frame gallery: render in place. */
  inline?: boolean;
  /** Extra class on the panel (the check-in log turns it into a bottom sheet at 390). */
  className?: string;
}

/** A-06 Guest drawer, with A-14 manual check-in, A-15 undo, revoke and the A-16 email mismatch review. */
export function GuestDrawer({ eventId, detail: loaded, preview, open = true, go: goTo, onDetail, loadError, onRetry, closeHref, dialog: initialDialog, inline, className }: GuestDrawerProps) {
  const router = useAdminRouter();
  // An action's answer shows at once, until the loader sends a newer detail (a new `loaded`).
  const [patch, setPatch] = useState<{ base: GuestDetail | null; value: GuestDetail }>();
  const detail = patch && patch.base === loaded ? patch.value : loaded;
  const setDetail = (value: GuestDetail) => {
    setPatch({ base: loaded, value });
    onDetail?.(value);
  };
  const [dialog, setDialog] = useState<Dialog | undefined>(initialDialog);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  // The drawer stays mounted from one guest to the next: the dialog, its note and its error belong to one guest.
  const record = `${loaded?.id ?? preview?.id ?? ""}:${initialDialog ?? ""}`;
  const [shown, setShown] = useState(record);
  if (shown !== record) {
    setShown(record);
    setDialog(initialDialog);
    setNote("");
    setError(undefined);
  }
  const close = () => (goTo ? goTo(closeHref) : router.push(closeHref, { scroll: false }));
  const closeDialog = () => {
    setDialog(undefined);
    setError(undefined);
  };

  const undo = (guestId: string, name: string) =>
    start(async () => {
      const result = await undoCheckInAction(eventId, guestId, actionCsrf());
      if (handleSessionExpired(result)) return;
      if ("error" in result) {
        setError(result.message ?? "Couldn’t undo the check-in. Try again.");
        return;
      }
      setDetail(result.detail);
      closeDialog();
      toast({ message: `${name}’s check-in was undone.` });
      router.refresh();
    });

  const checkIn = (guestId: string, name: string) =>
    start(async () => {
      // A thrown action (network, an unexpected refusal) is a message in the dialog too, never a silent close.
      const result = await manualCheckInAction(eventId, guestId, note, actionCsrf()).catch(() => ({ error: "invalid" as const, message: undefined }));
      if (handleSessionExpired(result)) return;
      if ("error" in result) {
        setError(result.message ?? "Couldn’t check them in. Try again.");
        return;
      }
      setDetail(result.detail);
      setNote("");
      closeDialog();
      toast({ message: `${name} checked in.`, duration: 10_000, action: { label: "Undo", onClick: () => undo(guestId, name) } });
      router.refresh();
    });

  const revoke = (guestId: string, name: string) =>
    start(async () => {
      const result = await bulkGuestsAction(eventId, "revoke", [guestId], actionCsrf());
      if (handleSessionExpired(result)) return;
      if ("error" in result || !result.changed.length) {
        setError("error" in result ? "Couldn’t revoke the invite. Try again." : (result.skipped[0]?.reason ?? "Couldn’t revoke the invite."));
        return;
      }
      if (detail) setDetail({ ...detail, status: "revoked" });
      closeDialog();
      toast({ message: `Revoked ${name}’s invite.` });
      router.refresh();
    });

  const sendLink = (guestId: string) =>
    start(async () => {
      const result = await bulkGuestsAction(eventId, "send", [guestId], actionCsrf());
      if (handleSessionExpired(result)) return;
      toast(
        "error" in result
          ? { message: "Couldn’t send the link. Try again.", tone: "danger" }
          : result.changed.length
            ? { message: "Link sent by email." }
            : { message: result.skipped[0]?.reason ?? "Couldn’t send the link.", tone: "danger" },
      );
    });

  const resolve = (guestId: string, choice: "accept" | "reverify") =>
    start(async () => {
      const reviewed = detail?.mismatch ? { session: detail.verification.session, email: detail.mismatch.verified } : undefined;
      const result = await resolveEmailMismatchAction(eventId, guestId, choice, actionCsrf(), reviewed);
      if (handleSessionExpired(result)) return;
      if ("error" in result) {
        toast({ message: "Couldn’t update the guest. Reload and try again.", tone: "danger" });
        return;
      }
      toast({ message: choice === "accept" ? "Email accepted." : "Sent a new verification link to the invited email." });
      router.refresh();
      close();
    });

  const checkedIn = detail?.status === "checked-in";
  const verified = detail?.status === "verified";
  const showInvite = !!detail?.invite.url && ["link-sent", "approved", "verifying", "in-review", "declined"].includes(detail.status);
  const firstName = detail?.name.split(" ")[0];
  const status = detail?.status ?? preview?.status;

  return (
    <>
      <Drawer
        open={open}
        inline={inline}
        onClose={close}
        className={cx(s.drawer, className)}
        width={520}
        contentKey={inline ? undefined : (loaded?.id ?? preview?.id)}
        eyebrow="Guest"
        media={
          detail ? (
            <PersonAvatar person={detail.person} />
          ) : preview ? (
            <PersonAvatar person={{ name: preview.name, email: preview.email, photoUrl: preview.person?.photoUrl ?? null }} />
          ) : (
            <Skeleton width={56} height={56} shape="pill" />
          )
        }
        title={
          detail ? (
            <PersonTitle person={detail.person} />
          ) : preview ? (
            <PersonTitle person={{ name: preview.name, verified: preview.person?.verified ?? null, timeZone: preview.person?.timeZone ?? "UTC" }} />
          ) : (
            <Skeleton width={260} height={22} />
          )
        }
        titleAside={status ? <StatusPill status={status} /> : undefined}
        subtitle={detail ? <PersonSubtitle person={detail.person} /> : preview ? <PersonSubtitlePreview email={preview.email} /> : <Skeleton width={180} height={12} />}
        footer={
          <>
            <Button variant="danger-outline" disabled={!detail || detail.status === "revoked" || checkedIn} onClick={() => setDialog("revoke")}>
              Revoke
            </Button>
            {checkedIn ? (
              <Button variant="secondary" onClick={() => setDialog("undo")}>
                Undo check-in
              </Button>
            ) : (
              <Button variant={verified ? "primary" : "secondary"} disabled={!detail || detail.status === "revoked"} onClick={() => setDialog("checkin")}>
                Manual check-in
              </Button>
            )}
          </>
        }
      >
        {detail ? (
          <>
            {detail.declineReason ? (
              <div className={`${s.callout} ${s.declined}`}>
                <b>Declined by Didit.</b> {detail.declineReason}
              </div>
            ) : null}
            {detail.mismatch ? (
              <div className={s.mismatch}>
                <p>
                  <b>Didit verified a different email.</b> {firstName} finished verification with another address. Accept it, or ask them to verify again with the invited one.
                </p>
                <div className={s.emails}>
                  <div className={s.emailBox}>
                    <span>Invited</span>
                    <b>{detail.mismatch.invited}</b>
                  </div>
                  <div className={s.emailBox}>
                    <span>Verified</span>
                    <b>{detail.mismatch.verified}</b>
                  </div>
                </div>
                <div className={s.mismatchActions}>
                  <Button size="sm" loading={pending} onClick={() => resolve(detail.id, "accept")}>
                    Accept this email
                  </Button>
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => resolve(detail.id, "reverify")}>
                    Ask to verify again
                  </Button>
                </div>
              </div>
            ) : detail.status === "in-review" ? (
              <div className={`${s.callout} ${s.review}`}>A Didit reviewer is checking this session. Usually under 2 hours.</div>
            ) : null}

            <PersonSections person={detail.person}>
              {showInvite ? (
                <section className={s.section} aria-label="Invite link">
                  <h3>Invite link</h3>
                  {detail.invite.sent ? <p className={s.sent}>Sent {detail.invite.sent}</p> : null}
                  <div className={s.copyRow}>
                    <CopyField label="Verification link" value={detail.invite.url} display={detail.invite.display} />
                    <Button size="sm" variant="secondary" disabled={pending || !canSendLink(detail.status)} onClick={() => sendLink(detail.id)}>
                      Send by email
                    </Button>
                  </div>
                </section>
              ) : null}
            </PersonSections>
          </>
        ) : loadError ? (
          <div className={`${s.callout} ${s.declined}`} role="alert">
            <b>Couldn’t load this guest.</b>{" "}
            <button type="button" className={s.retry} onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : (
          <div aria-busy="true" aria-label="Loading guest">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={s.skSection}>
                <Skeleton width="30%" height={10} />
                <Skeleton width="80%" height={10} />
                <Skeleton width="65%" height={10} />
              </div>
            ))}
          </div>
        )}
      </Drawer>

      {detail ? (
        <GuestDialogs
          name={detail.name}
          dialog={dialog}
          inline={inline}
          note={note}
          onNote={setNote}
          error={error}
          pending={pending}
          onClose={closeDialog}
          onCheckIn={() => checkIn(detail.id, detail.name)}
          onUndo={() => undo(detail.id, detail.name)}
          onRevoke={() => revoke(detail.id, detail.name)}
        />
      ) : null}
    </>
  );
}

export interface GuestDialogsProps {
  name: string;
  dialog?: Dialog;
  inline?: boolean;
  note: string;
  onNote: (v: string) => void;
  error?: string;
  pending: boolean;
  onClose: () => void;
  onCheckIn: () => void;
  onUndo: () => void;
  onRevoke: () => void;
}

/** A-14 manual check-in, A-15 undo check-in, and revoke. */
export function GuestDialogs({ name, dialog, inline, note, onNote, error, pending, onClose, onCheckIn, onUndo, onRevoke }: GuestDialogsProps) {
  const possessive = `${name}’s`;
  // A refusal (e.g. check-in before the event starts) stays in the open dialog, announced and in the danger colour.
  const alert = <span role="alert" className={s.dialogError}>{error}</span>;
  const body = (
    <>
      <Modal
        open={dialog === "checkin"}
        inline={inline}
        onClose={onClose}
        title={`Check in ${name} without face?`}
        description={error ? alert : "Use this when the kiosk can’t match them. It’s logged with your name."}
        width={400}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onClose} data-autofocus="">
              Cancel
            </Button>
            <Button size="sm" loading={pending} onClick={onCheckIn}>
              Check in
            </Button>
          </>
        }
      >
        <Textarea className={s.note} label="Note · optional" placeholder="e.g. ID checked at the door" maxLength={280} value={note} onChange={(e) => onNote(e.currentTarget.value)} />
      </Modal>
      <ConfirmDialog
        open={dialog === "undo"}
        inline={inline}
        onClose={onClose}
        title={`Undo ${possessive} check-in?`}
        description={error ? alert : "They show as missing again and can check in at the kiosk. The timeline keeps a line with your name."}
        confirmLabel="Undo check-in"
        loading={pending}
        onConfirm={onUndo}
      />
      <ConfirmDialog
        open={dialog === "revoke"}
        inline={inline}
        onClose={onClose}
        title={`Revoke ${possessive} invite?`}
        description={error ? alert : "Their verification link stops working and the kiosk won’t let them in."}
        confirmLabel="Revoke invite"
        destructive
        loading={pending}
        onConfirm={onRevoke}
      />
    </>
  );
  return inline && dialog ? <div className={s.dialogFrame}>{body}</div> : body;
}

const noop = () => {};

/** Frame gallery: A-14a / A-15a dialogs drawn open over the drawer (callbacks stay on the client). */
export function GuestDialogFrame({ name, dialog }: { name: string; dialog: Dialog }) {
  return <GuestDialogs name={name} dialog={dialog} inline note="" onNote={noop} pending={false} onClose={noop} onCheckIn={noop} onUndo={noop} onRevoke={noop} />;
}

/** Frame gallery: the A-14b "checked in · Undo" toast, drawn in place. */
export function UndoToastFrame({ message }: { message: string }) {
  return <Toast className={s.frameToast} message={message} action={{ label: "Undo", onClick: noop }} />;
}
