"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, MarkLoader, StatusIcon, type StatusIconName, type StatusTone } from "@didit-events/ui";
import type { ApiResult, OnboardingView, VerificationLaunch } from "../../onboarding";
import { blockedCopy } from "../../onboarding";
import { decisionPhase, initialFacePhase, launchPhase, sdkPhase, SETTLED_STUCK_MS, streamMode, viewPhase, watchesDecision, type CheckDecision, type FacePhase } from "../../join/machine";
import { startEmbedded } from "../../join/sdk";
import { useVerificationStream } from "../../join/stream";
import { SheetFooter } from "../SheetFooter";
import { SecuredByDidit } from "../SecuredByDidit";
import { StepBody, StepPane } from "./Step";
import j from "./Join.module.css";

export interface DiditCheckProps {
  titleId: string;
  /** Face: the server's onboarding view drives the outcome. Extras: the parent moves on when the context does. */
  view?: OnboardingView;
  /** Extras: a settled check that did not pass (from the refreshed request context). */
  decision?: CheckDecision | null;
  /** Extras: the operation id once the server has settled it (no endless "Checking" after that). */
  settledOpId?: string | null;
  /** Leave the check (not eligible for this event): "Back to event". */
  onExit?: () => void;
  /** Extras: the name on the ID does not match the profile; opens the profile name inline (no new check). */
  onFixName?: () => void;
  /** Create or resume the Didit session (never called while one launch is in flight). */
  launch: () => Promise<ApiResult<VerificationLaunch>>;
  /** Re-read the server view (on every stream signal). */
  refresh: () => Promise<unknown>;
  title: string;
  lead: ReactNode;
  /** Start straight in a phase (tests, frames, a launch the parent already made). */
  initial?: FacePhase;
  /** Test seam for the SDK. */
  embed?: typeof startEmbedded;
}

/**
 * One Didit check inside the modal: the session is created (or resumed) server-side and runs in our own container
 * with the Didit Web SDK in embedded mode. When the SDK says it is done we show "Checking your result…" and wait for
 * the server (webhook push over the verification stream, or the server's own decision reads); camera-blocked,
 * declined, expired and paused states are ours, each with Try again.
 */
export function DiditCheck({ titleId, view, decision = null, settledOpId = null, onExit, onFixName, launch, refresh, title, lead, initial, embed = startEmbedded }: DiditCheckProps) {
  const [phase, setPhase] = useState<FacePhase>(() => initial ?? (view ? initialFacePhase(view) : { phase: "starting" }));
  // The SDK reports ready per session URL (a retry mounts a new one).
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const containerId = `didit-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  // A fresh server view (pushed by the stream) may settle the check before the SDK says so.
  const [seenView, setSeenView] = useState(view);
  if (view !== seenView) {
    setSeenView(view);
    if (view) setPhase(viewPhase(phase, view));
  }
  const [seenDecision, setSeenDecision] = useState(decision);
  if (decision !== seenDecision) {
    setSeenDecision(decision);
    setPhase(decisionPhase(phase, decision));
  }

  // The parent's callbacks are read through refs: a new identity on every render must not relaunch.
  const calls = useRef({ launch, refresh });
  useEffect(() => {
    calls.current = { launch, refresh };
  });

  // Create / resume the session. The ref guards a double effect run or a double tap.
  const inFlight = useRef(false);
  useEffect(() => {
    if (phase.phase !== "starting" || inFlight.current) return;
    inFlight.current = true;
    let cancelled = false;
    void calls.current
      .launch()
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          // A bare error code ("provider_unavailable") is not copy: fall back to the phase's own sentence.
          setNotice(res.error.code === "rate_limited" ? "Too many attempts. Wait a minute and try again." : res.error.message && res.error.message !== res.error.code ? res.error.message : null);
          setPhase(res.error.code === "budget" || res.error.code === "provider_unavailable" || res.error.code === "review_required" ? { phase: "blocked", code: res.error.code } : { phase: "error" });
          return;
        }
        const next = launchPhase(res.data);
        if (next === "refresh") {
          await calls.current.refresh();
          return;
        }
        setPhase(next);
      })
      .catch(() => !cancelled && setPhase({ phase: "error" }))
      .finally(() => {
        inFlight.current = false;
      });
    return () => {
      cancelled = true;
      inFlight.current = false;
    };
  }, [phase.phase]);

  // Didit is still creating the session: ask again shortly (the server reuses the same operation).
  useEffect(() => {
    if (phase.phase !== "preparing") return;
    const t = setTimeout(() => setPhase({ phase: "starting" }), phase.retryAfterMs);
    return () => clearTimeout(t);
  }, [phase]);

  // Mount the SDK in our container while the check runs; any other phase tears the iframe down.
  const embeddedUrl = phase.phase === "embedded" ? phase.url : null;
  const sdkReady = embeddedUrl !== null && readyUrl === embeddedUrl;
  useEffect(() => {
    if (!embeddedUrl) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    embed(embeddedUrl, containerId, {
      onComplete: (result) => setPhase((p) => sdkPhase(p, result)),
      onState: (state) => {
        if (state === "ready") setReadyUrl(embeddedUrl);
        if (state === "error") setPhase({ phase: "error" });
      },
      onEvent: (event) => {
        if (event.type === "didit:ready" || event.type === "didit:started") setReadyUrl(embeddedUrl);
      },
    })
      .then((fn) => (cancelled ? fn() : (stop = fn)))
      .catch(() => !cancelled && setPhase({ phase: "error" }));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [embeddedUrl, containerId, embed]);

  // While a decision can arrive: real-time push, with the server reading Didit itself when no webhook comes (only
  // rarely while the guest is still in the camera UI). When the server cannot read Didit for a while, say so and offer
  // a manual check instead of waiting silently.
  const [slow, setSlow] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  useVerificationStream(watchesDecision(phase), () => void calls.current.refresh(), { mode: streamMode(phase), onLimited: () => setSlow(true) });
  const checkAgain = () => {
    setRechecking(true);
    void Promise.resolve(calls.current.refresh()).catch(() => undefined).finally(() => setRechecking(false));
  };

  // The server settled this operation but the step did not move on (nothing we could map): after a short wait, offer
  // Check again instead of an endless spinner.
  const stuckOp = phase.phase === "checking" && phase.opId && phase.opId === settledOpId ? phase.opId : null;
  useEffect(() => {
    if (!stuckOp) return;
    const t = setTimeout(() => setSlow(true), SETTLED_STUCK_MS);
    return () => clearTimeout(t);
  }, [stuckOp]);

  const retry = () => {
    setNotice(null);
    setSlow(false);
    setPhase({ phase: "starting" });
  };

  // One screen per phase (starting and preparing are the same wait); the SDK screen is the Didit panel alone (it
  // carries its own "Secured by Didit" mark; every other phase shows ours under its text).
  const screen = phase.phase === "preparing" ? "starting" : phase.phase === "checking" && slow ? "slow" : phase.phase;
  return (
    <StepPane step={screen} titleId={titleId} enter="change">
      {renderPhase()}
    </StepPane>
  );

  function renderPhase() {
  switch (phase.phase) {
    case "starting":
    case "preparing":
      return (
        <Waiting titleId={titleId} title={title} line={phase.phase === "preparing" ? "Didit is getting your check ready…" : "Preparing your check…"}>
          {lead}
        </Waiting>
      );
    case "embedded":
      return (
        <StepBody>
          <h2 id={titleId} className={j.title}>
            {title}
          </h2>
          <div className={j.sdkWrap}>
            <div id={containerId} className={j.sdk} data-didit-embedded="" />
            {sdkReady ? null : (
              <div className={j.sdkLoading} role="status">
                <MarkLoader size={40} />
                Loading Didit…
              </div>
            )}
          </div>
        </StepBody>
      );
    case "checking":
      if (slow)
        return (
          <State
            titleId={titleId}
            status="pending"
            title="Still checking…"
            action={
              <Button size="lg" block onClick={checkAgain} loading={rechecking}>
                Check again
              </Button>
            }
          >
            This is taking longer than usual. Your check is saved; check again in a moment.
          </State>
        );
      return (
        <Waiting titleId={titleId} title="Checking your result…" line="This usually takes a few seconds. You do not need to do anything.">
          Didit is confirming your check.
        </Waiting>
      );
    case "review":
      return (
        <State titleId={titleId} status="review" title="Your check needs a quick review">
          The Didit team is taking a look. We email you as soon as it is done; you can close this window.
        </State>
      );
    case "done":
      return (
        <State titleId={titleId} status="success" title="Verified">
          Thanks, you&apos;re all set.
        </State>
      );
    case "declined":
      return (
        <State titleId={titleId} status="error" title={view ? "We couldn't confirm it's you" : "We couldn't complete this check"} action={<Button size="lg" block onClick={retry}>Try again</Button>}>
          {/* `view` is set for the face step only; event extras (phone, ID, age) get check-neutral advice. */}
          {view ? "It usually works on a second try: face a window or a lamp, show your whole face and look at the camera." : "It usually works on a second try: check the details you entered and follow each step in the Didit window."}
        </State>
      );
    case "not_eligible": {
      const copy = notEligibleCopy(phase);
      const fixName = phase.reason === "name_mismatch" && onFixName ? onFixName : null;
      // The quiet action sits over the primary one, which is always last in the footer.
      const exit = onExit ? (
        <Button size="lg" block variant={phase.retry || fixName ? "secondary" : "primary"} onClick={onExit}>
          Back to event
        </Button>
      ) : null;
      return (
        <State
          titleId={titleId}
          status="error" icon="warning"
          title={copy.title}
          action={
            phase.retry || fixName ? (
              <>
                {exit}
                <Button size="lg" block onClick={fixName ?? retry}>
                  {fixName ? "Edit my name" : "Try again"}
                </Button>
              </>
            ) : (
              exit
            )
          }
        >
          {copy.body}
        </State>
      );
    }
    case "expired":
      return (
        <State titleId={titleId} status="warning" title="This check expired" action={<Button size="lg" block onClick={retry}>Start a new check</Button>}>
          Checks last a short while for your security. Your details are saved.
        </State>
      );
    case "cancelled":
      return (
        <State titleId={titleId} status="pending" title="Paused" action={<Button size="lg" block onClick={retry}>Continue</Button>}>
          You left the check before it finished. Pick up where you left off.
        </State>
      );
    case "camera":
      return (
        <State titleId={titleId} status="error" icon="warning" title="Your camera is blocked" action={<Button size="lg" block onClick={retry}>Try again</Button>}>
          <ul className={j.help}>
            <li>Allow camera access for this site in your browser&apos;s address bar, then try again.</li>
            <li>iPhone: Settings › Safari › Camera › Allow.</li>
            <li>No camera on this computer? Open this page on your phone and sign in with the same email.</li>
          </ul>
        </State>
      );
    case "blocked": {
      const copy = blockedCopy(phase.code);
      return (
        <State titleId={titleId} status={phase.code === "review_required" ? "review" : "warning"} title={copy.title} action={phase.code === "review_required" ? null : <Button size="lg" block onClick={retry}>Try again</Button>}>
          {notice && phase.code !== "review_required" ? notice : copy.body}
        </State>
      );
    }
    case "error":
      return (
        <State titleId={titleId} status="error" icon="warning" title="Something went wrong" action={<Button size="lg" block onClick={retry}>Try again</Button>}>
          {notice ?? "We could not open the check. Your details are saved."}
        </State>
      );
  }
  }
}

function notEligibleCopy(p: Extract<FacePhase, { phase: "not_eligible" }>): { title: string; body: string } {
  switch (p.reason) {
    case "below_minimum":
      return {
        title: "You don't meet this event's age limit",
        body: p.minimum ? `This event needs guests aged ${p.minimum}+. Your check says you don't meet it.` : "This event has a minimum age. Your check says you don't meet it.",
      };
    case "name_mismatch":
      return { title: "The name on your ID doesn't match your profile", body: "This event needs your profile name to match your ID. Update your name to continue; no new check needed." };
    default:
      return { title: "We couldn't use this check", body: "Didit finished, but the result did not confirm what this event needs. It usually works on a second try: good light and the whole document in view." };
  }
}

function Waiting({ titleId, title, line, children }: { titleId: string; title: string; line: string; children: ReactNode }) {
  return (
    <StepBody align="center">
      <div className={j.state} role="status" aria-live="polite">
        <span className={j.stateMark}>
          <MarkLoader size={44} />
        </span>
        <h2 id={titleId} className={j.title}>
          {title}
        </h2>
        <p className={j.lead}>{children}</p>
        <p className={j.muted}>{line}</p>
      </div>
      <SecuredByDidit />
    </StepBody>
  );
}

function State({ titleId, status, icon, title, action, children }: { titleId: string; status: StatusTone; icon?: StatusIconName; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <>
      <StepBody align="center">
        <div className={j.state}>
          <StatusIcon tone={status} icon={icon} size={56} />
          <h2 id={titleId} className={j.title}>
            {title}
          </h2>
          <div className={j.lead} role="status">
            {children}
          </div>
        </div>
        <SecuredByDidit />
      </StepBody>
      {action ? <SheetFooter>{action}</SheetFooter> : null}
    </>
  );
}
