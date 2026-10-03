"use client";

import { ONBOARDING_CONSENT } from "./OnboardingConsent";
import { CsrfField } from "../../auth/CsrfField";

import { useActionState, useId, useRef, useState } from "react";
import { Button, CodeInput, EmailField, TextField } from "@didit-events/ui";
import { dayMonth, shortDate, time } from "../../public/format";
import type { PublicEvent } from "../../public/types";
import { accountLinks } from "../links";
import type { RegisterField, RegisterInput, RegisterState } from "../types";
import { ResendTimer } from "./CodeParts";
import { Consent } from "./Consent";
import { Callout, CtaLink, EventChip, Eyebrow, FlowIcon, Foot, GuestScreen, Lead, SecuredByDidit, Spacer, Title, styles as s } from "./Screen";

export type RegisterAction = (prev: RegisterState, form: FormData) => Promise<RegisterState>;

export interface RegisterFlowProps {
  event: PublicEvent;
  initial: RegisterState;
  action: RegisterAction;
  codeMinutes?: number;
  /** Frame gallery: force the sending-code state (R-03), the focus look (R-01) and prefilled digits (R-04). */
  sending?: boolean;
  focus?: boolean;
  code?: string;
}

const EMPTY: Partial<RegisterInput> = { fullName: "", email: "", company: "", role: "", consent: false };

/**
 * Signed-out request (04 R-01…R-09): details in a bottom sheet over the event, the Didit email code (Didit Events'
 * own sign-in code, M-01), then "request sent". Passing the code also creates or signs in the guest account.
 */
export function RegisterFlow({ event, initial, action, codeMinutes = 5, ...forced }: RegisterFlowProps) {
  const titleId = useId();
  const errId = useId();
  const consentId = useId();
  const [state, dispatch, pending] = useActionState(action, initial);
  const [local, setLocal] = useState<{ base: RegisterState; step: RegisterState } | null>(null);
  const view = local && local.base === state ? local.step : state;
  const [values, setValues] = useState<Partial<RegisterInput>>(() => ({ ...EMPTY, ...("values" in initial ? initial.values : {}) }));
  const [intent, setIntent] = useState("");
  const [code, setCode] = useState(forced.code ?? "");
  const [touched, setTouched] = useState(false);
  const codeForm = useRef<HTMLFormElement>(null);
  const resendForm = useRef<HTMLFormElement>(null);
  const busy = (i: string) => (pending && intent === i) || (i === "details" && forced.sending);
  const submit = (i: string) => () => {
    setIntent(i);
    setTouched(false);
    if (i !== "verify") setCode("");
  };
  const set = (k: RegisterField) => (v: string | boolean) => setValues((old) => ({ ...old, [k]: v }));
  const backToForm = (clearEmail = false) => setLocal({ base: state, step: { step: "form", values: clearEmail ? { ...values, email: "" } : values } });
  const hiddenValues = (i: string) => (
    <>
      <input type="hidden" name="intent" value={i} />
      <input type="hidden" name="slug" value={event.slug} />
      {(["fullName", "email", "company", "role"] as const).map((k) => (
        <input key={k} type="hidden" name={k} value={String(values[k] ?? "")} />
      ))}
      <input type="hidden" name="consent" value={values.consent ? "on" : ""} />
      {values.consent ? <input type="hidden" name="onboardingConsent" value={JSON.stringify(ONBOARDING_CONSENT)} /> : null}
    </>
  );

  /* ── R-01 / R-02 / R-03: details ── */
  if (view.step === "form") {
    const errors = view.errors ?? {};
    const count = Object.keys(errors).length;
    const sending = busy("details");
    const ready = Boolean(values.fullName && values.email && values.consent);
    return (
      <GuestScreen header="none" sheet={{ event, variant: "flow" }} labelledBy={titleId}>
        <Title id={titleId} size={22}>
          Request to join
        </Title>
        {count ? <Callout tone="danger">{`Check the ${count} highlighted ${count === 1 ? "item" : "items"}.`}</Callout> : <Lead>Approval required. We will email you either way.</Lead>}
        <form action={dispatch} onSubmit={submit("details")} className={s.form} noValidate><CsrfField />
          <input type="hidden" name="intent" value="details" />
          <input type="hidden" name="slug" value={event.slug} />
          <TextField
            name="fullName"
            label="Full name"
            size="xl"
            placeholder="María García"
            autoComplete="name"
            value={values.fullName ?? ""}
            onChange={(e) => set("fullName")(e.target.value)}
            error={errors.fullName}
            readOnly={sending}
            required
            autoFocus
            state={forced.focus ? "focus" : undefined}
          />
          <EmailField name="email" label="Email" size="xl" placeholder="you@company.com" value={values.email ?? ""} onChange={(e) => set("email")(e.target.value)} error={errors.email} readOnly={sending} required />
          <TextField name="company" label="Company" size="xl" placeholder="Where you work" autoComplete="organization" value={values.company ?? ""} onChange={(e) => set("company")(e.target.value)} readOnly={sending} />
          <TextField name="role" label="Role · optional" size="xl" placeholder="What you do" autoComplete="organization-title" value={values.role ?? ""} onChange={(e) => set("role")(e.target.value)} readOnly={sending} />
          <Consent id={consentId} invalid={Boolean(errors.consent)} checked={Boolean(values.consent)} onChange={set("consent")} disabled={sending} />
          <Button type="submit" size="xl" block disabled={!ready && !count} loading={sending}>
            {sending ? "Sending code…" : "Continue"}
          </Button>
        </form>
        <SecuredByDidit />
      </GuestScreen>
    );
  }

  /* ── R-04 / R-05 / R-06: the Didit Events email code ── */
  if (view.step === "code") {
    const wrong = view.status === "wrong" && !touched;
    const expired = view.status === "expired" || view.status === "resent";
    return (
      <GuestScreen header="events" sheet={{ event, variant: "flow" }} labelledBy={titleId}>
        <EventChip event={event} variant="flow" />
        <Eyebrow>STEP 1 OF 2 · CONFIRM YOUR EMAIL</Eyebrow>
        <Title id={titleId}>{view.status === "expired" ? "That code expired" : "Enter the code we sent"}</Title>
        <Lead>
          {view.status === "expired"
            ? `Codes last ${codeMinutes} minutes. We just sent a new one to ${view.values.email}.`
            : view.status === "wrong"
              ? `We sent a 6-digit code to ${view.values.email}.`
              : `We sent a 6-digit code to ${view.values.email}. It expires in ${codeMinutes} minutes.`}
        </Lead>
        {expired && view.sentAt ? <Callout tone="info">{`New code sent at ${time(view.sentAt, event.timeZone)}.`}</Callout> : null}
        <form action={dispatch} ref={codeForm} onSubmit={submit("verify")} className={s.form} style={{ flex: 1 }}><CsrfField />
          {hiddenValues("verify")}
          <CodeInput
            name="code"
            label="6-digit code"
            value={code}
            onChange={(v) => {
              setCode(v);
              setTouched(true);
            }}
            onComplete={() => queueMicrotask(() => codeForm.current?.requestSubmit())}
            invalid={wrong}
            describedBy={wrong ? errId : undefined}
            autoFocus
            state={forced.focus ? "focus" : undefined}
          />
          {wrong ? (
            <p id={errId} className={s.codeError} role="alert">
              {`That code is not right. ${view.attemptsLeft ?? 0} ${view.attemptsLeft === 1 ? "attempt" : "attempts"} left.`}
            </p>
          ) : null}
          {view.status === "wrong" ? (
            <button type="button" className={s.resendButton} onClick={() => resendForm.current?.requestSubmit()}>
              Resend code
            </button>
          ) : (
            <ResendTimer key={view.sentAt ?? view.status} seconds={view.resendInSeconds} onResend={() => resendForm.current?.requestSubmit()} />
          )}
          <Spacer />
          <Button type="submit" size="xl" block disabled={code.length < 6 && !busy("verify")} loading={busy("verify")}>
            {busy("verify") ? "Checking…" : "Confirm"}
          </Button>
        </form>
        <button type="button" className={s.textButton} onClick={() => backToForm()}>
          Wrong email? Change it
        </button>
        <SecuredByDidit />
        <form action={dispatch} ref={resendForm} onSubmit={submit("resend")} hidden><CsrfField />
          {hiddenValues("resend")}
        </form>
      </GuestScreen>
    );
  }

  /* ── R-07 (this email) / R-33 (this browser): too many attempts ── */
  if (view.step === "locked") {
    const ip = view.scope === "ip";
    return (
      <GuestScreen header="events" sheet={{ event, variant: "flow" }} labelledBy={titleId}>
        <EventChip event={event} variant="flow" />
        <FlowIcon status={ip ? "info" : "warning"} />
        <Title id={titleId}>Too many attempts</Title>
        <div role="status">
          <Lead>
            {ip
              ? `Try again in ${view.minutes} minutes.`
              : `For your security we paused codes for this email. Try again in ${view.minutes} minutes, or use a different email.`}
          </Lead>
        </div>
        <Spacer />
        {ip ? null : (
          <Button size="xl" block onClick={() => backToForm(true)}>
            Use a different email
          </Button>
        )}
        <CtaLink href={accountLinks.event(event.slug)} secondary>
          Back to event
        </CtaLink>
        <SecuredByDidit />
      </GuestScreen>
    );
  }

  /* ── R-08: request sent ── */
  if (view.step === "sent") {
    return (
      <GuestScreen header="events" sheet={{ event, variant: "flow" }} labelledBy={titleId}>
        <EventChip event={event} variant="flow" />
        <Eyebrow>STEP 2 OF 2 · HOST APPROVAL</Eyebrow>
        <FlowIcon status="pending" />
        <Title id={titleId}>{`Your request is in, ${view.firstName}`}</Title>
        <div role="status">
          <Lead>{`The hosts review every request. You will hear back by ${shortDate(view.replyBy, event.timeZone)}. If approved, you verify once with Didit and walk in with your face.`}</Lead>
        </div>
        <Spacer />
        <CtaLink href={accountLinks.event(event.slug)} secondary>
          Back to event
        </CtaLink>
        <Foot>{`Confirmation sent to ${view.email}`}</Foot>
      </GuestScreen>
    );
  }

  /* ── R-09: already on the list ── */
  return (
    <GuestScreen header="events" sheet={{ event, variant: "flow" }} labelledBy={titleId}>
      <EventChip event={event} variant="flow" />
      <FlowIcon status="info" />
      <Title id={titleId}>You are already on the list</Title>
      <Lead>{`${view.email} requested a place on ${dayMonth(view.requestedAt, event.timeZone)}. Status: ${view.status}.`}</Lead>
      <Spacer />
      <CtaLink href={accountLinks.myEvent(event.slug)}>View my registration</CtaLink>
      <Button variant="secondary" size="lg" block className={s.cta2} onClick={() => backToForm(true)}>
        Use a different email
      </Button>
    </GuestScreen>
  );
}
