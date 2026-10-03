"use client";

import { ONBOARDING_CONSENT, OnboardingDisclosure } from "./OnboardingConsent";
import { CsrfField } from "../../auth/CsrfField";

import { useActionState, useId, useRef, useState, type ReactNode } from "react";
import { Button, CodeInput, EmailField, GoogleButton, MarkLoader } from "@didit-events/ui";
import { time } from "../../public/format";
import type { PublicEvent } from "../../public/types";
import type { SignInStep } from "../types";
import type { InAppInfo } from "../../auth/inapp";
import { GOOGLE_CANCELLED, GOOGLE_FAILED } from "../signin-copy";
import { InAppGoogle } from "./InAppGoogle";
import { AuthChoices, AuthModal, authStyles as a } from "./Auth";
import { LOGIN_CLOSE_HOME, onLoginClose } from "../login-close";
import { ResendTimer } from "./CodeParts";
import { Callout, CtaLink, FlowIcon, Foot, GuestScreen, Lead, SecuredByDidit, SheetFooter, Title, eventName, styles as s, type GuestScreenProps } from "./Screen";

export type SignInAction = (prev: SignInStep, form: FormData) => Promise<SignInStep>;

/** The frame of every `sheet` step: the join sheet's top row (logo, the event's name, close). */
function LoginSheet({ event, labelledBy, onClose, children }: { event?: PublicEvent; labelledBy: string; onClose: GuestScreenProps["onClose"]; children: ReactNode }) {
  return (
    <GuestScreen header="events" sheet={{ event, variant: "account" }} labelledBy={labelledBy} closeHref={LOGIN_CLOSE_HOME} onClose={onClose} topLabel={event ? eventName(event) : undefined}>
      {children}
    </GuestScreen>
  );
}

export interface LoginFlowProps {
  /** sheet = mobile (05 U-01…U-13), modal = desktop (DA-01…DA-05). */
  layout: "sheet" | "modal";
  initial: SignInStep;
  action: SignInAction;
  /** Where a passed code lands (same-origin path). */
  next: string;
  /** The event being requested, for the chip and the sheet backdrop. */
  event?: PublicEvent;
  title?: string;
  /** The line under the title on the first step (default: the guest "request a place" copy). */
  lead?: string;
  googleHref: string;
  /** Set by the server inside an in-app browser (X, LinkedIn, Instagram…): the email code leads and Google explains itself first. */
  inApp?: InAppInfo | null;
  /** U-03: back from Google, the session is being created. */
  googlePending?: boolean;
  /** Code lifetime shown in the copy (Didit: 5 minutes). */
  codeMinutes?: number;
  /** Forces the U-13 "Signing you in" screen (frame gallery). */
  signingIn?: boolean;
  /** Forces the focus look on inputs (frame gallery). */
  focus?: boolean;
  /** Prefilled code digits (frame gallery: R-04 shows "481"). */
  code?: string;
}

/**
 * Guest sign-in with a Didit email code or Google via Didit. One server action drives every step (send, resend,
 * verify); the choose → code navigation that needs no server happens in place.
 *
 * `sheet` is the join sheet's design (JoinAuth) on its own page: the logo + close top row, Continue with Google, the
 * email field with "Email me a code" on the same screen, the legal copy under the buttons, 44px buttons. Every step
 * stays in that frame (full screen below 768px, a centred modal from 768px).
 */
export function LoginFlow(props: LoginFlowProps) {
  const { layout, action, next, event, googleHref: baseGoogleHref, codeMinutes = 5, inApp } = props;
  // Flow v3: no consent checkbox. The disclosure is shown and continuing records the consent receipt.
  const googleHref = `${baseGoogleHref}${baseGoogleHref.includes("?") ? "&" : "?"}consent=${encodeURIComponent(JSON.stringify(ONBOARDING_CONSENT))}`;
  const disclosure = <OnboardingDisclosure />;
  const TITLE_ID = useId();
  const close = onLoginClose(next);
  const errId = useId();
  const [state, dispatch, pending] = useActionState(action, props.initial);
  const [local, setLocal] = useState<{ base: SignInStep; step: SignInStep } | null>(null);
  const [intent, setIntent] = useState<string>("");
  const [code, setCode] = useState(props.code ?? "");
  const [email, setEmail] = useState(("email" in props.initial && props.initial.email) || "");
  const [codeTouched, setCodeTouched] = useState(false);
  const codeForm = useRef<HTMLFormElement>(null);
  const resendForm = useRef<HTMLFormElement>(null);

  const view: SignInStep = local && local.base === state ? local.step : state;
  const go = (step: SignInStep) => setLocal({ base: state, step });
  const submitting = (i: string) => pending && intent === i;
  const onSubmit = (i: string) => () => {
    setIntent(i);
    if (i === "verify") setCodeTouched(false);
    if (i === "send" || i === "resend") setCode("");
  };

  const hidden = (i: string, withEmail = true): ReactNode => (
    <>
      <input type="hidden" name="intent" value={i} />
      <input type="hidden" name="onboardingConsent" value={JSON.stringify(ONBOARDING_CONSENT)} />
      <input type="hidden" name="next" value={next} />
      {withEmail ? <input type="hidden" name="email" value={"email" in view && view.email ? view.email : email} /> : null}
    </>
  );

  const frame = { event, labelledBy: TITLE_ID, onClose: close };

  const resend = (label: string, secondary = false) => (
    <form action={dispatch} ref={resendForm} onSubmit={onSubmit("resend")} className={s.actionForm}><CsrfField />
      {hidden("resend")}
      <Button type="submit" variant={secondary ? "secondary" : "primary"} size="lg" block loading={submitting("resend")} className={layout === "modal" ? a.cta : undefined}>
        {submitting("resend") ? "Sending code…" : label}
      </Button>
    </form>
  );
  const resendNow = () => resendForm.current?.requestSubmit();

  // A result screen (expired, locked): the legal copy closes the text, and the actions are the footer on the bottom
  // edge, the quiet one over the primary one.
  const google = (label: string) => (
    <CtaLink href={googleHref} secondary modal>
      {label}
    </CtaLink>
  );

  /* ── U-13: signing you in ── */
  if (props.signingIn || (submitting("verify") && layout === "sheet")) {
    return (
      <LoginSheet {...frame}>
        {/* The loader takes the 56px box of the status icons on the other screens. */}
        <span className={a.mark}>
          <MarkLoader size={44} />
        </span>
        <Title id={TITLE_ID}>Signing you in</Title>
        <div role="status">
          <Lead>One second…</Lead>
        </div>
      </LoginSheet>
    );
  }

  /* ── Code entry (U-08, U-10, U-12, DA-03) and the code screens that replace it ── */
  if (view.step === "code" && view.status !== "expired") {
    const wrong = view.status === "wrong" && !codeTouched;
    const codeField = (
      <>
        <CodeInput
          name="code"
          label="6-digit code"
          value={code}
          onChange={(v) => {
            setCode(v);
            setCodeTouched(true);
          }}
          onComplete={() => queueMicrotask(() => codeForm.current?.requestSubmit())}
          invalid={wrong}
          describedBy={wrong ? errId : undefined}
          autoFocus
          state={props.focus ? "focus" : undefined}
        />
        {wrong ? (
          <p id={errId} className={s.codeError} role="alert">
            {`That code is not right. ${view.attemptsLeft ?? 0} ${view.attemptsLeft === 1 ? "attempt" : "attempts"} left.`}
          </p>
        ) : null}
      </>
    );
    const body = (
      <>
        {view.status === "resent" ? `We sent a new code to ${view.email}. Earlier codes no longer work.` : `We sent a code to ${view.email}. It expires in ${codeMinutes} minutes.`}
      </>
    );
    const title = view.status === "resent" ? "Enter the new code" : "Enter the 6-digit code";
    const resentNote = view.status === "resent" && view.sentAt ? <Callout tone="info">{`New code sent at ${time(view.sentAt, event?.timeZone ?? "Europe/Madrid")}.`}</Callout> : null;
    const timer = (center: boolean, prefix?: string) =>
      view.status === "wrong" ? (
        <button type="button" className={s.resendButton} onClick={resendNow} style={center ? { alignSelf: "center" } : undefined}>
          Resend code
        </button>
      ) : (
        <ResendTimer key={view.sentAt ?? view.status} seconds={view.resendInSeconds} center={center} prefix={prefix} onResend={resendNow} />
      );
    const differentEmail = (
      <Button variant="secondary" size="lg" block className={layout === "modal" ? a.cta : undefined} onClick={() => go({ step: layout === "modal" ? "choose" : "email", email: view.email })}>
        Use a different email
      </Button>
    );
    const confirm = (
      <Button type="submit" size="lg" block disabled={code.length < 6 && !submitting("verify")} loading={submitting("verify")} className={layout === "modal" ? a.cta : undefined}>
        {submitting("verify") ? "Checking…" : "Confirm"}
      </Button>
    );
    const hiddenResend = (
      <form action={dispatch} ref={resendForm} onSubmit={onSubmit("resend")} hidden><CsrfField />
        {hidden("resend")}
      </form>
    );
    if (layout === "modal") {
      return (
        <AuthModal closeHref={LOGIN_CLOSE_HOME} onClose={close} labelledBy={TITLE_ID} event={event}>
          <FlowIcon status="info" icon="mail" size={48} />
          <h1 id={TITLE_ID} className={a.title}>
            {title}
          </h1>
          <p className={a.body}>{body}</p>
          {resentNote}
          <form action={dispatch} ref={codeForm} onSubmit={onSubmit("verify")} className={a.form}><CsrfField />
            {hidden("verify")}
            {codeField}
            {confirm}
          </form>
          {differentEmail}
          <div className={a.foot}>{timer(false)}</div>
          {disclosure}
          <SecuredByDidit />
          {hiddenResend}
        </AuthModal>
      );
    }
    return (
      <LoginSheet {...frame}>
        <Title id={TITLE_ID}>{title}</Title>
        <Lead>{body}</Lead>
        {resentNote}
        <form action={dispatch} ref={codeForm} onSubmit={onSubmit("verify")} className={s.form}><CsrfField />
          {hidden("verify")}
          {codeField}
          {confirm}
        </form>
        {view.status === "sent" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <CtaLink href="https://mail.google.com" secondary>
              Open Gmail
            </CtaLink>
            <CtaLink href="https://outlook.live.com" secondary>
              Open Outlook
            </CtaLink>
          </div>
        ) : null}
        {differentEmail}
        {timer(true)}
        <Foot>Nothing? Check spam, or wait a minute.</Foot>
        {disclosure}
        <SecuredByDidit />
        {hiddenResend}
      </LoginSheet>
    );
  }

  /* ── U-11 / DA-05: code expired ── */
  if (view.step === "code" && view.status === "expired") {
    if (layout === "modal")
      return (
        <AuthModal closeHref={LOGIN_CLOSE_HOME} onClose={close} labelledBy={TITLE_ID} event={event}>
          <FlowIcon status="warning" size={48} />
          <h1 id={TITLE_ID} className={a.title}>
            This code has expired
          </h1>
          <p className={a.body}>{`Codes last ${codeMinutes} minutes and work once.`}</p>
          {disclosure}
          <SecuredByDidit />
          <SheetFooter>
            {google("Continue with Google")}
            {resend("Send a new code")}
          </SheetFooter>
        </AuthModal>
      );
    return (
      <LoginSheet {...frame}>
        <Title id={TITLE_ID}>This code has expired</Title>
        <Lead>{`Codes last ${codeMinutes} minutes. We can send a fresh one to ${view.email}.`}</Lead>
        {disclosure}
        <SecuredByDidit />
        <SheetFooter>
          {google("Continue with Google")}
          {resend("Send a new code")}
        </SheetFooter>
      </LoginSheet>
    );
  }

  /* ── U-09 / R-33: locked ── */
  if (view.step === "locked") {
    const ip = view.scope === "ip";
    const title = "Too many attempts";
    const body = ip
      ? `Try again in ${view.minutes} minutes.`
      : `For your security we paused codes for ${view.email}. Try again at ${time(view.retryAt, event?.timeZone ?? "Europe/Madrid")}, or continue with Google.`;
    if (layout === "modal")
      return (
        <AuthModal closeHref={LOGIN_CLOSE_HOME} onClose={close} labelledBy={TITLE_ID} event={event}>
          <FlowIcon status={ip ? "info" : "warning"} size={48} />
          <h1 id={TITLE_ID} className={a.title}>
            {title}
          </h1>
          <p className={a.body} role="status">
            {body}
          </p>
          {disclosure}
          <SecuredByDidit />
          <SheetFooter>{google("Continue with Google instead")}</SheetFooter>
        </AuthModal>
      );
    return (
      <LoginSheet {...frame}>
        <Title id={TITLE_ID}>{title}</Title>
        <div role="status">
          <Lead>{body}</Lead>
        </div>
        {ip ? null : disclosure}
        <SecuredByDidit />
        <SheetFooter>{ip ? <CtaLink href={event ? `/e/${event.slug}` : "/events"} secondary>{event ? "Back to event" : "Explore events"}</CtaLink> : google("Continue with Google instead")}</SheetFooter>
      </LoginSheet>
    );
  }

  /* ── Email entry: the inline field of the sheet (as in the join sheet) and of DA-01 / DA-02 / DA-04 ── */
  const error = "error" in view ? view.error : undefined;
  const errorShown = error && email === (("email" in view && view.email) || "");
  // Inside an in-app browser the note says what the failure banner would; a real browser never shows "inapp".
  const chooseBanner = view.step === "choose" ? view.banner : undefined;
  const noteOpen = !!inApp && (chooseBanner === "inapp" || chooseBanner === "google_failed");
  const visibleBanner = chooseBanner === "inapp" || noteOpen ? undefined : chooseBanner;
  const emailForm = (modal: boolean) => (
    <form action={dispatch} onSubmit={onSubmit("send")} className={modal ? a.form : s.form} noValidate><CsrfField />
      {hidden("send", false)}
      <EmailField
        name="email"
        label={modal ? "Email" : inApp ? "Your email" : "Or use your email"}
        className={a.field}
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errorShown ? error : undefined}
        required
        autoFocus={!modal && view.step === "email"}
        state={props.focus ? "focus" : undefined}
      />
      <Button type="submit" size="lg" block loading={submitting("send")} className={modal ? a.cta : undefined}>
        {submitting("send") ? "Sending code…" : "Email me a code"}
      </Button>
    </form>
  );

  if (layout === "modal") {
    const banner = visibleBanner;
    return (
      <AuthModal closeHref={LOGIN_CLOSE_HOME} onClose={close} labelledBy={TITLE_ID} event={event}>
        <h1 id={TITLE_ID} className={a.title}>
          {props.title ?? "Sign in to request a place"}
        </h1>
        <p className={a.body}>Create a free account or sign in. No password.</p>
        {banner ? (
          <Callout tone={banner === "google_failed" ? "danger" : "neutral"}>
            {banner === "google_failed"
              ? GOOGLE_FAILED
              : banner === "google_cancelled"
                ? GOOGLE_CANCELLED
                : "Your session has ended. Sign in again to continue. Your registrations are safe."}
          </Callout>
        ) : null}
        {inApp && !props.googlePending ? (
          <>
            {emailForm(true)}
            <InAppGoogle inApp={inApp} googleHref={googleHref} open={noteOpen} />
          </>
        ) : (
          <>
            <AuthChoices googleHref={googleHref} googlePending={props.googlePending} size="lg" />
            {emailForm(true)}
          </>
        )}
        {disclosure}
        <SecuredByDidit />
      </AuthModal>
    );
  }

  /* ── The sheet's first screen (choose, and email: its field is on the same screen) ── */
  const banner = visibleBanner;
  const expired = banner === "session_expired";
  return (
    <LoginSheet {...frame}>
      <Title id={TITLE_ID}>{expired ? "Please sign in again" : (props.title ?? "Request to join")}</Title>
      {expired ? (
        <Lead>Your session has ended. Sign in again to continue. Your registrations are safe.</Lead>
      ) : banner || props.googlePending ? null : (
        <Lead>{props.lead ?? "Create a free Didit Events account to request a place. No password."}</Lead>
      )}
      {banner && !expired ? (
        <Callout tone={banner === "google_failed" ? "danger" : "neutral"}>
          {banner === "google_failed" ? GOOGLE_FAILED : GOOGLE_CANCELLED}
        </Callout>
      ) : null}
      {props.googlePending ? (
        <GoogleButton variant="outline" size="lg" loading loadingLabel="Signing in with Google…" />
      ) : inApp ? null : (
        <GoogleButton variant="outline" size="lg" href={googleHref} />
      )}
      {emailForm(false)}
      {inApp && !props.googlePending ? <InAppGoogle inApp={inApp} googleHref={googleHref} open={noteOpen} /> : null}
      {disclosure}
      <SecuredByDidit />
    </LoginSheet>
  );
}
