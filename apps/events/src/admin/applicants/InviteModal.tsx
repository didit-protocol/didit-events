"use client";
import { actionCsrf } from "../../auth/client";

import { useId, useRef, useState, useTransition } from "react";
import { Button, CopyField, Modal, Textarea } from "@didit-events/ui";
import { inviteAction, shareLinkAction } from "../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions";
import { handleSessionExpired } from "../system/session";
import { useAdminRouter } from "../useAdminRouter";
import { ToggleRow } from "./Dialogs";
import { checkInviteEmails, splitEmails } from "./query";
import type { InviteEmailCheck, InviteSummary, ShareLinks } from "./types";
import s from "./Applicants.module.css";

type Step = { kind: "compose" } | { kind: "sending"; done: number; total: number } | { kind: "sent"; summary: InviteSummary };

export interface InviteModalProps {
  eventId: string;
  tab: "email" | "link";
  closeHref: string;
  /** Emails already on the event (the "Already requested" check; the server re-checks). */
  existingEmails: string[];
  links: ShareLinks;
  inline?: boolean;
  /** Frame gallery: the drawn state. */
  initial?: { emails?: string[]; message?: string; step?: Step; copied?: boolean };
}

const CHECK_TEXT: Record<Exclude<InviteEmailCheck["check"], "ready">, string> = { invalid: "Invalid email", existing: "Already requested · will be approved", duplicate: "Listed twice · sent once" };

/** AP-16…AP-20: invite by email (chips, checks, sending, sent) or share a link. */
export function InviteModal({ eventId, tab: initialTab, closeHref, existingEmails, links, inline, initial }: InviteModalProps) {
  const router = useAdminRouter();
  const [tab, setTab] = useState(initialTab);
  const [emails, setEmails] = useState<string[]>(initial?.emails ?? []);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [skipApproval, setSkipApproval] = useState(true);
  const [sendLink, setSendLink] = useState(true);
  const [step, setStep] = useState<Step>(initial?.step ?? { kind: "compose" });
  const [error, setError] = useState<string>();
  const [privateLink, setPrivateLink] = useState(links.privateLink);
  const [, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const close = () => router.push(closeHref, { scroll: false });

  const checks = checkInviteEmails(emails, existingEmails);
  const sendable = checks.filter((c) => c.check === "ready" || c.check === "existing");
  const flagged = checks.filter((c) => c.check !== "ready");
  const ready = checks.length - flagged.length;

  const commit = (text: string) => {
    const next = splitEmails(text);
    if (next.length) setEmails((e) => [...e, ...next]);
    setDraft("");
  };

  const send = () => {
    if (!sendable.length) {
      setError("Add at least one valid email.");
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    void (async () => {
      const list = [...new Set(sendable.map((c) => c.email.toLowerCase()))];
      const total: InviteSummary = { invited: 0, approvedExisting: 0, waitlisted: 0, skippedInvalid: checks.filter((c) => c.check === "invalid").length };
      // One request per email so the AP-18 progress is real; the server re-validates each address.
      for (let i = 0; i < list.length; i++) {
        setStep({ kind: "sending", done: i, total: list.length });
        const r = await inviteAction(eventId, [list[i]], message, skipApproval, sendLink, actionCsrf()).catch(() => ({ error: "conflict" as const }));
        if (handleSessionExpired(r)) return;
        if ("error" in r) {
          setStep({ kind: "compose" });
          setError("Couldn’t send the invites. Nothing after the failed one was sent. Try again.");
          return;
        }
        total.invited += r.summary.invited;
        total.approvedExisting += r.summary.approvedExisting;
        total.waitlisted += r.summary.waitlisted;
        total.skippedInvalid += r.summary.skippedInvalid;
        total.alreadyRequested = (total.alreadyRequested ?? 0) + (r.summary.alreadyRequested ?? 0);
      }
      setStep({ kind: "sent", summary: total });
      router.refresh();
    })();
  };

  if (step.kind === "sending") {
    return (
      <Modal open inline={inline} onClose={() => {}} dismissible={false} title="Sending invites…" closeLabel="Close" width={560} className={s.modal} footer={<Button loading>Sending…</Button>}>
        <div className={s.progress} role="status" aria-live="polite">
          <div className={s.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={step.total} aria-valuenow={step.done} aria-label="Invites sent">
            <div className={s.progressFill} style={{ width: `${(step.done / step.total) * 100}%` }} />
          </div>
          <span>
            {step.done} of {step.total} · sending invitations
          </span>
        </div>
      </Modal>
    );
  }

  if (step.kind === "sent") {
    const n = step.summary.invited + step.summary.approvedExisting;
    return (
      <Modal
        open
        inline={inline}
        onClose={close}
        title={`${n} invite${n === 1 ? "" : "s"} sent`}
        closeLabel="Close"
        width={480}
        className={s.modal}
        description={skipApproval ? "Invitees receive an email with their next step." : "New invitees can request a place. Existing requests stay pending."}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setEmails([]);
                setMessage("");
                setStep({ kind: "compose" });
              }}
            >
              Invite more
            </Button>
            <Button onClick={close}>Done</Button>
          </>
        }
      >
        <dl className={s.summary}>
          <div>
            <dt>New invites</dt>
            <dd>{step.summary.invited}</dd>
          </div>
          <div>
            <dt>Existing request approved</dt>
            <dd>{step.summary.approvedExisting}</dd>
          </div>
          {step.summary.waitlisted ? (
            <div>
              <dt>Waitlisted (event full)</dt>
              <dd>{step.summary.waitlisted}</dd>
            </div>
          ) : null}
          {step.summary.alreadyRequested ? <div><dt>Already requested</dt><dd>{step.summary.alreadyRequested}</dd></div> : null}
          {step.summary.skippedInvalid ? (
            <div>
              <dt>Skipped</dt>
              <dd data-tone="bad">
                {step.summary.skippedInvalid} invalid email{step.summary.skippedInvalid === 1 ? "" : "s"}
              </dd>
            </div>
          ) : null}
        </dl>
      </Modal>
    );
  }

  const tabs = (
    <div className={s.modalTabs} role="tablist" aria-label="How to invite">
      {(["email", "link"] as const).map((t) => (
        <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
          {t === "email" ? "Invite by email" : "Share a link"}
        </button>
      ))}
    </div>
  );

  if (tab === "link") {
    return (
      <Modal open inline={inline} onClose={close} title="Invite guests" closeLabel="Close" width={560} className={s.modal} footer={<Button onClick={close}>Done</Button>}>
        {tabs}
        <div className={s.copies} role="tabpanel">
          <div className={s.field}>
            <span className={s.fieldLabel}>Public request link</span>
            <CopyField label="Public request link" value={`https://${links.publicLink}`} display={links.publicLink} />
            <span className={s.hint}>Anyone can request. You approve each one.</span>
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel}>Private invite link</span>
            {privateLink ? <CopyField label="Private invite link" value={privateLink.startsWith("http") ? privateLink : `https://${privateLink}`} display={privateLink} copied={initial?.copied} /> : <Button onClick={() => start(async () => { const result = await shareLinkAction(eventId, actionCsrf()); if (handleSessionExpired(result)) return; if ("error" in result) setError("Couldn’t create the link. Try again."); else setPrivateLink(result.url); })}>Create private link</Button>}
            <span className={s.hint}>{links.privateHint}</span>
            {error ? <span role="alert">{error}</span> : null}
          </div>
        </div>
      </Modal>
    );
  }

  const invalid = flagged.some((c) => c.check === "invalid");
  return (
    <Modal
      open
      inline={inline}
      onClose={close}
      title="Invite guests"
      closeLabel="Close"
      width={560}
      className={s.modal}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={send}>{sendable.length ? `Send ${sendable.length} invite${sendable.length === 1 ? "" : "s"}` : "Send invites"}</Button>
        </>
      }
    >
      {tabs}
      <div className={s.field} role="tabpanel">
        <label className={s.fieldLabel} htmlFor={`${hintId}-in`}>
          Emails
        </label>
        <div className={s.chipBox} data-invalid={invalid || error ? "" : undefined} onClick={() => inputRef.current?.focus()}>
          {checks.map((c, i) => (
            <span key={`${c.email}-${i}`} className={s.chip} data-check={c.check}>
              {c.email}{" "}
              <button type="button" aria-label={`Remove ${c.email}`} onClick={() => setEmails((e) => e.filter((_, j) => j !== i))}>
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={`${hintId}-in`}
            className={s.chipInput}
            type="text"
            inputMode="email"
            autoComplete="off"
            value={draft}
            placeholder={emails.length ? "" : "name@company.com, …"}
            aria-describedby={`${hintId}-h${error ? ` ${hintId}-e` : ""}`}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (/[\s,;]$/.test(v)) commit(v);
              else setDraft(v);
            }}
            onPaste={(e) => {
              e.preventDefault();
              commit(draft + e.clipboardData.getData("text"));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(draft);
              }
              if (e.key === "Backspace" && !draft && emails.length) setEmails((x) => x.slice(0, -1));
            }}
            onBlur={() => draft && commit(draft)}
          />
        </div>
        <span id={`${hintId}-h`} className={s.hint}>
          Paste many at once, separated by commas or new lines.
        </span>
        {error ? (
          <span id={`${hintId}-e`} role="alert" className={s.fieldError}>
            {error}
          </span>
        ) : null}
      </div>
      {flagged.length ? (
        <ul className={s.checks} aria-label="Email checks">
          {flagged.map((c, i) => (
            <li key={`${c.email}-${i}`} data-check={c.check}>
              <b>{c.email}</b>
              <span>{c.check === "existing" && !skipApproval ? "Already requested · stays pending" : CHECK_TEXT[c.check as Exclude<InviteEmailCheck["check"], "ready">]}</span>
            </li>
          ))}
          {ready ? (
            <li data-check="ready">
              <b>{ready === 1 ? "1 other" : `${ready} others`}</b>
              <span>Ready</span>
            </li>
          ) : null}
        </ul>
      ) : null}
      <Textarea label="Message (optional)" className={s.textarea} placeholder="Add a personal line…" value={message} maxLength={500} rows={2} onChange={(e) => setMessage(e.currentTarget.value)} />
      <ToggleRow label="Skip approval" hint="Invitees go straight to verification" checked={skipApproval} onChange={setSkipApproval} />
      {flagged.length ? null : <ToggleRow label="Send Didit verification link now" hint="Off: they accept the invite first, then verify" checked={sendLink} onChange={setSendLink} />}
    </Modal>
  );
}
