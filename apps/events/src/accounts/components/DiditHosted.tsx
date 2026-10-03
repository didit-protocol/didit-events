import { Button, CodeInput, TextField, cx } from "@didit-events/ui";
import { MARIA_EMAIL } from "../fixtures";
import { FlowIcon, GuestScreen, Lead, SecuredByDidit, Spacer, StepList, Title, styles as s } from "./Screen";
import d from "./DiditHosted.module.css";

/**
 * The Didit hosted verification (04 R-11…R-18): questionnaire, email code, liveness. Didit renders these pages;
 * Didit Events only links to them and shows the result, so this component exists for the gallery's flow context.
 */
export type DiditStep = "name" | "code" | "code_wrong" | "selfie_intro" | "camera_blocked" | "adjust" | "hold" | "processing";

const LABELS = ["Name", "Email code", "Selfie"];
const at: Record<DiditStep, number> = { name: 0, code: 1, code_wrong: 1, selfie_intro: 2, camera_blocked: 2, adjust: 2, hold: 2, processing: 3 };
const TIPS = [
  { title: "Find good light", hint: "Face a window or a lamp" },
  { title: "Show your whole face", hint: "Glasses on is fine, no hats or masks" },
  { title: "Hold the phone at eye level", hint: "Follow the hint on screen" },
];

function Progress({ n, current }: { n: number; current: boolean }) {
  return (
    <ol className={d.steps} aria-label="Verification progress">
      {LABELS.map((l, i) => (
        <li key={l} className={d.step} aria-current={i === n && current ? "step" : undefined}>
          <span className={cx(d.bar, i < n && d.barDone, i === n && current && d.barNow)} />
          <span className={cx(d.label, i <= n && d.labelOn)}>{l}</span>
        </li>
      ))}
    </ol>
  );
}

export function DiditHosted({ step }: { step: DiditStep }) {
  const n = at[step];
  const title = "didit-title";
  return (
    <GuestScreen header="didit" labelledBy={title}>
      <Progress n={n} current={step !== "processing"} />
      {step === "name" ? (
        <>
          <Title id={title} size={26}>
            Confirm your name
          </Title>
          <Lead>Use your name as it appears on your ID.</Lead>
          <TextField label="First name" size="xl" defaultValue="María" readOnly />
          <TextField label="Last name" size="xl" defaultValue="García" readOnly state="focus" />
          <Spacer />
          <Button size="xl" block>
            Continue
          </Button>
        </>
      ) : null}
      {step === "code" || step === "code_wrong" ? (
        <>
          <Title id={title} size={26}>
            Check your inbox
          </Title>
          <Lead>{step === "code" ? `Didit sent a code to ${MARIA_EMAIL}. It expires in 10 minutes.` : `Didit sent a code to ${MARIA_EMAIL}.`}</Lead>
          <CodeInput name="didit-code" label="Didit code" defaultValue={step === "code" ? "73" : "730216"} invalid={step === "code_wrong"} state="focus" />
          {step === "code_wrong" ? <p className={s.codeError}>Incorrect code. 4 attempts left.</p> : null}
          {step === "code" ? <p className={s.resend}>Resend in 0:37</p> : <span className={s.resendButton}>Resend code</span>}
          <Spacer />
          <Button size="xl" block disabled={step === "code"}>
            Verify email
          </Button>
        </>
      ) : null}
      {step === "selfie_intro" ? (
        <>
          <Title id={title} size={26}>
            Take a quick selfie
          </Title>
          <Lead>A 3-second liveness check proves it is really you.</Lead>
          <StepList steps={TIPS} tone="soft" label="Selfie tips" />
          <Spacer />
          <Button size="xl" block>
            Open camera
          </Button>
          <p className={s.foot}>Didit does not share your image with the event.</p>
        </>
      ) : null}
      {step === "camera_blocked" ? (
        <>
          <FlowIcon status="warning" />
          <Title id={title} size={26}>
            Camera access needed
          </Title>
          <Lead>Your browser blocked the camera. On iPhone: Settings, Safari, Camera, Allow. Then come back here.</Lead>
          <Spacer />
          <Button size="xl" block>
            Try again
          </Button>
          <Button variant="secondary" size="lg" block className={s.cta2}>
            Continue on another device
          </Button>
        </>
      ) : null}
      {step === "adjust" || step === "hold" ? (
        <>
          <Title id={title} size={22}>
            {step === "adjust" ? "Fit your face in the oval" : "Perfect, hold still"}
          </Title>
          <div className={d.cam} aria-hidden="true">
            <div className={d.face} />
            <div className={cx(d.oval, step === "hold" && d.ovalHold)} />
            <div className={d.hint}>
              <span>{step === "adjust" ? "Move a little closer" : "Hold still…"}</span>
            </div>
          </div>
        </>
      ) : null}
      {step === "processing" ? (
        <div className={d.processing} role="status">
          <svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(120,120,128,.3)" strokeWidth="3" />
            <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="#4B5058" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <h1 id={title} className={d.processingTitle}>
            Checking your selfie…
          </h1>
          <p className={d.processingHint}>Usually 2 seconds</p>
        </div>
      ) : null}
      <SecuredByDidit />
    </GuestScreen>
  );
}
