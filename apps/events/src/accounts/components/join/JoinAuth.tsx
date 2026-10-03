"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Button, CodeInput, EmailField, GoogleButton } from "@didit-events/ui";
import { CsrfField } from "../../../auth/CsrfField";
import type { InAppInfo } from "../../../auth/inapp";
import { GOOGLE_CANCELLED, GOOGLE_FAILED } from "../../signin-copy";
import type { SignInStep } from "../../types";
import { InAppGoogle } from "../InAppGoogle";
import { ResendTimer } from "../CodeParts";
import { ONBOARDING_CONSENT, OnboardingDisclosure } from "../OnboardingConsent";
import { SheetFooter } from "../SheetFooter";
import { SecuredByDidit } from "../SecuredByDidit";
import { StepBody } from "./Step";
import j from "./Join.module.css";

export type SignInAction = (prev: SignInStep, form: FormData) => Promise<SignInStep>;

/** "Create your account → verify you're human → get recognised at your next Didit event". `next`: the first step not done is what happens from here (an arrow, not a number that reads as unfinished). */
export function JoinPath({ done = 0, next = false }: { done?: number; next?: boolean }) {
  return (
    <ol className={j.path} aria-label="How it works">
      {["Create your account", "Verify you're human, once", "Get recognised at your next Didit event"].map((label, i) => (
        <li key={label} data-done={i < done ? "" : undefined} data-next={next && i === done ? "" : undefined}>
          {label}
        </li>
      ))}
    </ol>
  );
}

/**
 * Step 1 of the join modal for a signed-out visitor: Continue with Google, or email → 6-digit Didit code. No consent
 * checkbox: the disclosure is on screen and the consent receipt (with its version) is recorded when they continue.
 * A passed code redirects back to `next` (the event page with the modal open), which re-reads the account.
 */
export function JoinAuth({ action, next, googleHref, titleId, eventName, codeMinutes = 5, initial = { step: "choose" }, inApp }: { action: SignInAction; next: string; googleHref: string; titleId: string; eventName: string; codeMinutes?: number; initial?: SignInStep; /** Inside an in-app browser: the email code leads, Google explains itself first. */ inApp?: InAppInfo | null }) {
  const [state, dispatch, pending] = useActionState(action, initial);
  const [email, setEmail] = useState(("email" in initial && initial.email) || "");
  const [code, setCode] = useState("");
  const [intent, setIntent] = useState("");
  const [edit, setEdit] = useState<SignInStep | null>(null);
  const codeForm = useRef<HTMLFormElement>(null);
  const resendForm = useRef<HTMLFormElement>(null);
  const errId = useId();
  // The footer's buttons submit forms that sit in the body over them.
  const codeFormId = useId();
  const resendFormId = useId();
  const view = edit && edit !== state ? edit : state;
  const busy = (i: string) => pending && intent === i;
  const google = `${googleHref}${googleHref.includes("?") ? "&" : "?"}consent=${encodeURIComponent(JSON.stringify(ONBOARDING_CONSENT))}`;
  const hidden = (i: string, address?: string) => (
    <>
      <CsrfField />
      <input type="hidden" name="intent" value={i} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="onboardingConsent" value={JSON.stringify(ONBOARDING_CONSENT)} />
      {address !== undefined ? <input type="hidden" name="email" value={address} /> : null}
    </>
  );
  const submitting = (i: string) => () => {
    setIntent(i);
    setEdit(null);
    if (i !== "verify") setCode("");
  };

  if (view.step === "code" || view.step === "locked") {
    const address = view.email ?? email;
    const locked = view.step === "locked";
    const expired = view.step === "code" && view.status === "expired";
    const wrong = view.step === "code" && view.status === "wrong" && code.length < 6;
    return (
      <>
        <StepBody>
          <h2 id={titleId} className={j.title}>
            {locked ? "Too many attempts" : expired ? "This code has expired" : "Check your email"}
          </h2>
          <p className={j.lead}>
            {locked
              ? `For your security we paused codes for ${address}. Continue with Google, or try again later.`
              : expired
                ? `Codes last ${codeMinutes} minutes and work once. We can send a fresh one to ${address}.`
                : view.status === "resent"
                  ? `We sent a new code to ${address}. Earlier codes no longer work.`
                  : `We sent a 6-digit code to ${address}. It expires in ${codeMinutes} minutes.`}
          </p>
          {locked || expired ? null : (
            <form id={codeFormId} action={dispatch} ref={codeForm} onSubmit={submitting("verify")} className={j.form}>
              {hidden("verify", address)}
              <CodeInput
                name="code"
                label="6-digit code"
                value={code}
                onChange={setCode}
                onComplete={() => queueMicrotask(() => codeForm.current?.requestSubmit())}
                invalid={wrong}
                describedBy={wrong ? errId : undefined}
                autoFocus
              />
              {wrong ? (
                <p id={errId} className={j.error} role="alert">
                  {`That code is not right. ${view.attemptsLeft ?? 0} ${view.attemptsLeft === 1 ? "attempt" : "attempts"} left.`}
                </p>
              ) : null}
            </form>
          )}
          <form id={resendFormId} action={dispatch} ref={resendForm} onSubmit={submitting("resend")} hidden>
            {hidden("resend", address)}
          </form>
          {!locked && !expired ? (
            view.status === "wrong" ? (
              <button type="button" className={j.textButton} onClick={() => resendForm.current?.requestSubmit()}>
                Resend code
              </button>
            ) : (
              <ResendTimer key={view.sentAt ?? view.status} seconds={view.resendInSeconds} center onResend={() => resendForm.current?.requestSubmit()} />
            )
          ) : null}
          <SecuredByDidit />
        </StepBody>
        <SheetFooter>
          <button type="button" className={j.textButton} onClick={() => setEdit({ step: "choose", email: address })}>
            Use a different email
          </button>
          {locked ? (
            <GoogleButton variant="outline" size="lg" href={google} />
          ) : expired ? (
            <Button type="submit" form={resendFormId} size="lg" block loading={busy("resend")}>
              {busy("resend") ? "Sending code…" : "Send a new code"}
            </Button>
          ) : (
            <Button type="submit" form={codeFormId} size="lg" block disabled={code.length < 6 && !busy("verify")} loading={busy("verify")}>
              {busy("verify") ? "Checking…" : "Continue"}
            </Button>
          )}
        </SheetFooter>
      </>
    );
  }

  const error = "error" in view ? view.error : undefined;
  const banner = view.step === "choose" ? view.banner : undefined;
  // Inside an in-app browser the note says what the failure banner would.
  const noteOpen = !!inApp && (banner === "inapp" || banner === "google_failed");
  return (
    // Two ways in (Google, or the email code), each next to what it needs: no single action to pin in a footer.
    <>
      <h2 id={titleId} className={j.title}>
        Request to join
      </h2>
      <p className={j.lead}>
        {`Create your account for ${eventName}. You'll verify you're human once, and you'll be recognised at your next Didit event.`}
      </p>
      <JoinPath />
      {!noteOpen && (banner === "google_failed" || banner === "google_cancelled") ? (
        <p className={j.error} role="alert">
          {banner === "google_failed" ? GOOGLE_FAILED : GOOGLE_CANCELLED}
        </p>
      ) : null}
      {inApp ? null : <GoogleButton variant="outline" size="lg" href={google} />}
      <form action={dispatch} onSubmit={submitting("send")} className={j.form} noValidate>
        {hidden("send")}
        <EmailField
          name="email"
          label={inApp ? "Your email" : "Or use your email"}
          placeholder="you@company.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error && email === (("email" in view && view.email) || "") ? error : undefined}
          required
          data-autofocus=""
        />
        <Button type="submit" size="lg" block loading={busy("send")}>
          {busy("send") ? "Sending code…" : "Email me a code"}
        </Button>
      </form>
      {inApp ? <InAppGoogle inApp={inApp} googleHref={google} open={noteOpen} /> : null}
      <OnboardingDisclosure />
      <SecuredByDidit />
    </>
  );
}
