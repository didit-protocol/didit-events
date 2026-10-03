"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Banner, Button, EmailPreview, Segmented, TextField, Switch, cx } from "@didit-events/ui";
import type { EmailPreview as Preview, EmailTemplateView, EmailTestResult, EventEmailCode, EventEmails } from "../model/contract";
import { EMAIL_VARIABLES } from "../model/contract";
import { MarkdownEditor } from "./MarkdownEditor";
import { httpEmailTransport, isEmail, setOverride, stubEmailTemplates, type EmailTransport, type SamplePreview } from "./emails";
import { EMAIL_BODY_MAX, SUBJECT_MAX, uuid, type V2Errors } from "./editor";
import s from "./Sections.module.css";

export interface EmailEditorProps {
  value: EventEmails;
  onChange: (next: EventEmails) => void;
  /** Saved event: previews and test sends go through the server. New event: sample previews, no test sends. */
  eventId?: string;
  editVersion?: number;
  /** The loader's template rows; defaults to the stub rows for the current overrides. */
  templates?: EmailTemplateView[];
  transport?: EmailTransport;
  errors: V2Errors;
  readOnly?: boolean;
  /** Tests: preview debounce. */
  debounceMs?: number;
  /** Frames and tests: a sample rendering while there is no server preview (real routes pass none). */
  samplePreview?: SamplePreview;
}

type PreviewState = { state: "loading" } | { state: "ready"; preview: Preview; sample: boolean } | { state: "error"; message: string };
type TestState = { state: "idle" } | { state: "sending" } | { state: "result"; result: EmailTestResult; to: string } | { state: "error"; message: string };

const STATUS_COPY: Record<EmailTestResult["status"], string> = {
  queued: "Queued. Waiting for the mail provider…",
  sent: "Sent to the mail provider. Delivery not confirmed yet.",
  delivered: "Delivered.",
  failed: "Failed to send.",
};

function TemplatePanel({ view, value, onChange, eventId, editVersion, transport, errors, readOnly, debounceMs, samplePreview }: Omit<EmailEditorProps, "templates" | "transport"> & { view: EmailTemplateView; transport: EmailTransport; debounceMs: number }) {
  const ids = useId();
  const override = value.templates[view.code];
  const [size, setSize] = useState<"desktop" | "mobile">("desktop");
  const [preview, setPreview] = useState<PreviewState>({ state: "loading" });
  const [to, setTo] = useState("");
  const [toError, setToError] = useState<string>();
  const [test, setTest] = useState<TestState>({ state: "idle" });
  const poll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = JSON.stringify(override ?? null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setPreview((p) => (p.state === "ready" ? p : { state: "loading" }));
      const input = { template: view.code, preview: { kind: "sample" as const }, override: override ?? undefined, expectedEventVersion: editVersion ?? 1 };
      const r = eventId ? await transport.preview(eventId, input) : ({ ok: false, error: { code: "unavailable", message: "" } } as const);
      if (!live) return;
      if (r.ok) return setPreview({ state: "ready", preview: r.data, sample: false });
      if (r.error.code !== "unavailable") return setPreview({ state: "error", message: r.error.message });
      if (!samplePreview)
        return setPreview({ state: "error", message: eventId ? "Previews aren’t available yet: the email preview service isn’t connected." : "Save the event as a draft to preview its emails." });
      try {
        const sample = await samplePreview(view.code);
        if (live) setPreview({ state: "ready", preview: sample, sample: true });
      } catch {
        if (live) setPreview({ state: "error", message: "Preview unavailable." });
      }
    }, debounceMs);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the override's value identity.
  }, [view.code, key, eventId, editVersion, transport, debounceMs, samplePreview]);
  useEffect(() => () => clearTimeout(poll.current), []);

  const setField = (p: { subject?: string | undefined; body_md?: string | undefined }) => {
    const cur = override ?? { enabled: true };
    const next = { ...cur, ...p };
    if (p.subject === undefined && "subject" in p) delete next.subject;
    onChange(setOverride(value, view.code, next));
  };

  const watch = (testId: string, target: string, n = 0) => {
    poll.current = setTimeout(async () => {
      const r = await transport.testStatus(eventId!, testId);
      if (!r.ok) return;
      setTest({ state: "result", result: r.data, to: target });
      if ((r.data.status === "queued" || r.data.status === "sent") && n < 20) watch(testId, target, n + 1);
    }, 3000);
  };
  const send = async () => {
    const target = to.trim();
    if (!isEmail(target)) return setToError("Enter an email address");
    if (!eventId) return;
    setToError(undefined);
    setTest({ state: "sending" });
    const r = await transport.sendTest(eventId, { template: view.code, to: target, preview: { kind: "sample" }, override: override ?? undefined, expectedEventVersion: editVersion ?? 1, idempotencyKey: uuid() });
    if (!r.ok) {
      const mins = r.error.code === "rate_limited" && "retryAfterMs" in r.error && r.error.retryAfterMs ? Math.ceil(r.error.retryAfterMs / 60_000) : null;
      return setTest({
        state: "error",
        message:
          r.error.code === "rate_limited"
            ? `Test limit reached: 10 per hour.${mins ? ` Try again in ${mins} min.` : ""}`
            : r.error.code === "unavailable"
              ? "Test sending isn’t connected yet. Nothing was sent."
              : r.error.message,
      });
    }
    setTest({ state: "result", result: r.data, to: target });
    if (r.data.status === "queued" || r.data.status === "sent") watch(r.data.testId, target);
  };

  const p = preview.state === "ready" ? preview.preview : null;
  return (
    <div className={s.emailPanel} id={`${ids}-panel`}>
      <div className={s.row2}>
        <TextField
          label={<>Subject{<span className={s.opt}> · leave empty for the default</span>}</>}
          value={override?.subject ?? ""}
          placeholder={p && preview.state === "ready" && !preview.sample ? p.subject : "Default subject"}
          maxLength={SUBJECT_MAX + 20}
          readOnly={readOnly || !view.canEdit}
          error={errors[`email:${view.code}:subject`]}
          onChange={(e) => setField(e.target.value ? { subject: e.target.value.replace(/[\r\n]+/g, " ") } : { subject: undefined })}
        />
      </div>
      <MarkdownEditor
        label={<>Your message{<span className={s.opt}> · optional, shown above the standard content</span>}</>}
        value={override?.body_md ?? ""}
        onChange={(v) => setField({ body_md: v })}
        maxLength={EMAIL_BODY_MAX}
        rows={5}
        allowImages={false}
        readOnly={readOnly || !view.canEdit}
        error={errors[`email:${view.code}:body`]}
        hint={`Variables: ${EMAIL_VARIABLES.map((v) => `{{${v}}}`).join(" ")}. Status, buttons and footer stay as Didit sends them.`}
      />

      <div className={s.previewHead}>
        <span className={s.blockTitle}>Preview</span>
        <Segmented
          name={`${ids}-size`}
          label="Preview width"
          size="sm"
          value={size}
          onChange={(v) => setSize(v === "mobile" ? "mobile" : "desktop")}
          options={[
            { value: "desktop", label: "Desktop · 600" },
            { value: "mobile", label: "Mobile · 390" },
          ]}
        />
      </div>
      {preview.state === "ready" && preview.sample ? (
        <Banner tone="info" className={s.sampleBanner}>
          Sample of the default template. Your subject and message show here once the preview service is connected.
        </Banner>
      ) : null}
      <div className={s.previewScroll} aria-busy={preview.state === "loading" || undefined}>
        {preview.state === "ready" ? (
          <EmailPreview
            size={size}
            from={parseSender(preview.preview.from)}
            subject={preview.preview.subject}
            preheader={`Reply-to: ${preview.preview.replyTo}`}
            html={preview.preview.html}
            initialHeight={size === "mobile" ? 700 : 600}
          />
        ) : preview.state === "error" ? (
          <p className={s.help}>{preview.message}</p>
        ) : (
          <p className={s.help}>Loading preview…</p>
        )}
      </div>

      <div className={s.testRow}>
        <TextField
          label="Send a test to"
          type="email"
          inputMode="email"
          placeholder="name@company.com"
          value={to}
          error={toError}
          readOnly={!eventId}
          hint={eventId ? "Any address. Sample data, subject starts with [Test]. Links in tests don’t sign anyone in." : "Save the event as a draft to send tests."}
          onChange={(e) => {
            setTo(e.target.value);
            setToError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button variant="secondary" onClick={() => void send()} loading={test.state === "sending"} disabled={!eventId || test.state === "sending"}>
          Send test
        </Button>
      </div>
      <p className={s.testStatus} role="status" aria-live="polite">
        {test.state === "result"
          ? `${test.to}: ${STATUS_COPY[test.result.status]}${test.result.errorCode ? ` (${test.result.errorCode})` : ""}`
          : test.state === "error"
            ? test.message
            : ""}
      </p>
    </div>
  );
}

/** "Didit Events <events@updates.didit.me>" → parts for the inbox header. */
export function parseSender(raw: string): { name: string; address: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  return m ? { name: m[1] || m[2]!, address: m[2]! } : { name: raw, address: raw };
}

/**
 * Emails: every event lifecycle email with its trigger, an enabled switch (critical notices are locked on, with the
 * reason), the sender and reply-to, a real preview at 600 and 390 px, subject + message overrides and Send test.
 */
export function EmailEditor({ value, onChange, eventId, editVersion, templates, transport = httpEmailTransport, errors, readOnly, debounceMs = 400, samplePreview }: EmailEditorProps) {
  const rows = templates ?? stubEmailTemplates(value);
  const [open, setOpen] = useState<EventEmailCode | null>(null);
  const sender = rows[0];
  const setEnabled = (code: EventEmailCode, enabled: boolean) => onChange(setOverride(value, code, { ...(value.templates[code] ?? { enabled: true }), enabled }));

  return (
    <div className={s.stack}>
      {sender ? (
        <dl className={s.senderBox}>
          <div>
            <dt>From</dt>
            <dd>{sender.from}</dd>
          </div>
          <div>
            <dt>Reply-to</dt>
            <dd>{sender.replyTo}</dd>
          </div>
          <p className={s.help}>Set by Didit for every event. Replies go to the events team.</p>
        </dl>
      ) : null}
      <ul className={s.emailList} aria-label="Lifecycle emails">
        {rows.map((t) => {
          const o = value.templates[t.code];
          const enabled = o?.enabled !== false || !t.canDisable;
          const customised = Boolean(o?.subject !== undefined || o?.body_md);
          const expanded = open === t.code;
          return (
            <li key={t.code} className={s.emailRow} data-open={expanded ? "" : undefined} data-off={enabled ? undefined : ""}>
              <div className={s.emailHead}>
                <span className={s.code}>{t.code}</span>
                <span className={s.emailText}>
                  <span className={s.rowTitle}>
                    {t.title}
                    {customised ? <span className={s.badge}>Customised</span> : null}
                  </span>
                  <span className={s.help}>{t.trigger}</span>
                </span>
                <span className={s.emailTools}>
                  <button type="button" className={s.link} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : t.code)}>
                    {expanded ? "Close" : "Preview & edit"}
                  </button>
                  <span className={s.lockWrap} title={t.canDisable ? undefined : "Guests must always get this notice"}>
                    <Switch
                      aria-label={`${t.title} email ${enabled ? "on" : "off"}`}
                      checked={enabled}
                      disabled={readOnly || !t.canDisable}
                      aria-describedby={t.canDisable ? undefined : `lock-${t.code}`}
                      onChange={(e) => setEnabled(t.code, e.target.checked)}
                    />
                  </span>
                </span>
              </div>
              {!t.canDisable ? (
                <span id={`lock-${t.code}`} className={cx(s.help, s.lockNote)}>
                  Always sent: guests must get this notice.
                </span>
              ) : t.code === "M-13" ? (
                <span className={cx(s.help, s.lockNote)}>Sent at check-in only; it is not the admission email.</span>
              ) : null}
              {errors[`email:${t.code}:enabled`] ? <span className={s.error}>{errors[`email:${t.code}:enabled`]}</span> : null}
              {expanded ? <TemplatePanel view={t} value={value} onChange={onChange} eventId={eventId} editVersion={editVersion} transport={transport} errors={errors} readOnly={readOnly} debounceMs={debounceMs} samplePreview={samplePreview} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
