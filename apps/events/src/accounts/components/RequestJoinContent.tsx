"use client";

import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Checkbox, Textarea, TextField, cx } from "@didit-events/ui";
import { actionCsrf } from "../../auth/client";
import { errorCopy } from "../api-client";
import type { PublicEvent } from "../../public/types";
import { accountLinks, safeNext } from "../links";
import { httpOnboardingApi, type OnboardingApi } from "../onboarding-api";
import { faceConsent, facePurpose, profileBoostNeeded } from "../onboarding";
import { canAutoSubmit, checksDecision, initialFacePhase, resultCopy, resultStatus, settledCheckOp } from "../join/machine";
import { closedCopy, expectedRegistration, oneTap as nothingToAsk, rejoinCopy, rejoinOf, statusCopy } from "../join/rejoin-copy";
import type { GuestRegistrationView } from "@didit-events/core/contracts/event-model";
import { DiditCheck, type DiditCheckProps } from "./join/DiditCheck";
import { StepLoading } from "./join/StepLoading";
import { StepBody, StepPane } from "./join/Step";
import { SecuredByDidit } from "./SecuredByDidit";
import {
  askPhone,
  buildApplication,
  httpRequestApi,
  questionsToAsk,
  requestConsent,
  requestStep,
  validateAnswers,
  type Answer,
  type AnswerErrors,
  type Question,
  type RequestApi,
  type RequestContext,
} from "../request-join";
import { Callout, CtaLink, Eyebrow, FlowIcon, Lead, MetGlyph, RowGroup, SheetFooter, Title, styles as s } from "./Screen";
import o from "./Onboarding.module.css";
// The modal is its own lazy chunk: its steps load with it.
import { MissingProfile, Extras } from "./RequestSteps";
import type { PhotoUploadAction } from "./PhotoUploader";

// "Complete your profile" (after a request, when the optional profile has gaps) loads only when it is offered.
const loadProfileSteps = () => import("./join/ProfileSteps");
const ProfileSteps = lazy(() => loadProfileSteps().then((m) => ({ default: m.ProfileSteps })));

export interface RequestJoinProps {
  event: PublicEvent;
  initial: RequestContext;
  /** Transports; default = lane A's routes with the session CSRF token. */
  api?: RequestApi;
  profileApi?: OnboardingApi;
  /** Leaves the page (links only; the request itself stays in the modal). */
  navigate?: (url: string) => void;
  /** Frame gallery: preset errors and a notice. */
  initialErrors?: AnswerErrors;
  /** Send the request on its own once nothing is left to ask (the guest tapped Request to join in this tab). */
  autoSubmit?: boolean;
  /** The request went out (or already existed): the event page refreshes its card when the modal closes. */
  onRegistered?: (registration: GuestRegistrationView) => void;
  /** Closes the modal (the result screen's button). */
  onClose?: () => void;
  /** SDK seam for tests. */
  embed?: DiditCheckProps["embed"];
  /** The /me/profile photo actions for the profile step after a request (else it links to the photo page). */
  photo?: { upload: PhotoUploadAction; remove: PhotoUploadAction };
}

/**
 * Request to join for a signed-in guest (flow v3, inside the event page's modal): no second sign-in, no email
 * re-verification; only what is missing is asked, one screen at a time — profile fields, "Verify you're human" then
 * the Didit panel alone, the event's extras, its questions — then the request goes out (on its own when nothing is left
 * to ask), the result shows here, and "Complete your profile" opens the optional profile one screen per gap.
 */
export function RequestJoinContent({ event, initial, api: apiProp, profileApi: profileApiProp, navigate, initialErrors, autoSubmit = false, onRegistered, onClose, embed, photo }: RequestJoinProps) {
  const [api] = useState<RequestApi>(() => apiProp ?? httpRequestApi(initial.event.id, actionCsrf));
  const [profileApi] = useState<OnboardingApi>(() => profileApiProp ?? httpOnboardingApi(actionCsrf));
  const [ctx, setCtx] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<GuestRegistrationView | null>(null);
  /** The extras check this tab launched (the SDK runs in the modal). */
  const [extrasLaunch, setExtrasLaunch] = useState<{ url: string; opId: string } | null>(null);
  /** The name on the ID did not match the profile: the name field is open inline. */
  const [fixingName, setFixingName] = useState(false);
  /** "Verify you're human" is read (Next) before the Didit panel opens (a guest requesting again goes straight to it). */
  const [faceIntro, setFaceIntro] = useState(() => !rejoinOf(initial));
  /** The one-tap request again is shown as sent while the server confirms it (rolled back on an error). */
  const [optimistic, setOptimistic] = useState(false);
  /** The submission attempt outlives the form (the optimistic result unmounts it): a retry reuses its idempotency key. */
  const attemptKey = useRef<Attempt | null>(null);
  /** After a fresh request: "Complete your profile" opened the profile screens. */
  const [profileOpen, setProfileOpen] = useState(false);
  // Memoised on the context: a new object on every render would re-apply the decision in DiditCheck.
  const extrasDecision = useMemo(() => checksDecision(ctx), [ctx]);
  const go = navigate ?? ((url: string) => window.location.assign(url));
  const step = requestStep(ctx);
  const titleId = "request-title";
  const back = accountLinks.event(event.slug);
  const registration = submitted ?? (step === "status" ? ctx.registration : null);
  const again = rejoinOf(ctx);

  useEffect(() => {
    if (registration && !optimistic) onRegistered?.(registration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registration?.id, registration?.admission, optimistic]);

  /** The extras operation this tab launched last (a relaunch may resume or replace it): refreshes pin it. */
  const checksOp = useRef<string | null>(null);
  const refresh = async (pin?: string) => {
    const res = await api.refresh(pin);
    if (res.ok) setCtx(res.data);
    return res;
  };

  // Only a first request sent here (never an existing registration, never a request again) offers the profile, and never
  // blocking it: it has gone out.
  const offerProfile = submitted !== null && !optimistic && !again && profileBoostNeeded(ctx.onboarding);
  useEffect(() => {
    if (offerProfile) void loadProfileSteps().catch(() => undefined);
  }, [offerProfile]);

  const faceIntroShown = step === "face" && faceIntro && initialFacePhase(ctx.onboarding).phase === "starting";
  const screen = submitted
    ? profileOpen && offerProfile
      ? "profile-steps"
      : "result"
    : registration
      ? "status"
      : step === "form" && again && nothingToAsk(ctx)
        ? "rejoin"
        : step === "face"
      ? faceIntroShown
        ? "face-intro"
        : "face"
      : step === "extras"
        ? fixingName
          ? "extras-name"
          : extrasLaunch
            ? "extras-check"
            : "extras"
        : step;
  const frame = (children: ReactNode) => (
    <StepPane step={screen} titleId={titleId} order={SCREEN_ORDER.indexOf(screen)}>
      {notice ? <Callout tone="warning">{notice}</Callout> : null}
      {children}
    </StepPane>
  );

  if (registration && !submitted) {
    const copy = statusCopy(registration, event.title);
    return frame(<RegistrationStatus titleId={titleId} copy={copy} onClose={onClose} backHref={back} />);
  }
  if (registration) {
    if (screen === "profile-steps")
      return frame(
        <Suspense fallback={<StepLoading />}>
          <ProfileSteps titleId={titleId} onboarding={ctx.onboarding} profileApi={profileApi} photo={photo} onClose={onClose} backHref={back} />
        </Suspense>,
      );
    return frame(<JoinResult titleId={titleId} eventName={event.title} registration={registration} onClose={onClose} fresh={submitted !== null} onCompleteProfile={offerProfile ? () => setProfileOpen(true) : undefined} backHref={back} />);
  }

  switch (step) {
    case "status":
      return frame(
        <>
          <StepBody>
            <Title id={titleId} size={22}>
              Your registration
            </Title>
          </StepBody>
          <SheetFooter>
            <CtaLink href={accountLinks.myEvent(event.slug)}>View my registration</CtaLink>
          </SheetFooter>
        </>,
      );
    case "unavailable": {
      const closed = closedCopy(ctx.availability);
      return frame(
        <>
          <StepBody>
            <Title id={titleId} size={22}>
              {closed.title}
            </Title>
            <Lead>{closed.lead}</Lead>
          </StepBody>
          <SheetFooter>
            {onClose ? (
              <Button size="lg" block variant="secondary" onClick={onClose}>
                Back to event
              </Button>
            ) : (
              <CtaLink href={back}>Back to event</CtaLink>
            )}
          </SheetFooter>
        </>,
      );
    }
    case "face":
      if (faceIntroShown) {
        const expired = ctx.onboarding.face?.state === "expired";
        return frame(
          <>
            <StepBody align="center">
              <div className={o.result}>
                <FlowIcon status="info" icon="eye" />
                <Title id={titleId} size={24}>
                  {expired ? "Time to refresh your face check" : "Verify you're human"}
                </Title>
                <Lead>
                  {expired
                    ? "Face checks last 180 days and yours has ended. One new selfie and the door recognises you again; hosts never see it."
                    : "Next, one quick selfie with Didit, once for every Didit event. The door recognises you, and hosts never see it."}
                </Lead>
              </div>
              <SecuredByDidit />
            </StepBody>
            <SheetFooter>
              <Button size="lg" block variant="secondary" onClick={onClose ?? (() => go(back))}>
                Not now
              </Button>
              <Button size="xl" block onClick={() => setFaceIntro(false)}>
                Next
              </Button>
            </SheetFooter>
          </>,
        );
      }
      return frame(
        <DiditCheck
          titleId={titleId}
          view={ctx.onboarding}
          embed={embed}
          launch={() => profileApi.startFace({ purpose: facePurpose(ctx.onboarding), consent: faceConsent(), returnTo: accountLinks.join(event.slug) })}
          refresh={refresh}
          title={ctx.onboarding.face?.state === "expired" ? "Time to refresh your face check" : "Verify you're human"}
          lead={
            ctx.onboarding.face?.state === "expired"
              ? "Face checks last 180 days and yours has ended. One new selfie and the door recognises you again."
              : "One quick selfie with Didit, once for every Didit event. At the door, just look at the screen."
          }
        />,
      );
    case "profile":
      return frame(<MissingProfile onboarding={ctx.onboarding} profileApi={profileApi} titleId={titleId} onSaved={refresh} onNotice={setNotice} />);
    case "extras":
      return frame(
        fixingName ? (
          <MissingProfile
            nameOnly
            onboarding={ctx.onboarding}
            profileApi={profileApi}
            titleId={titleId}
            onNotice={setNotice}
            onCancel={() => setFixingName(false)}
            onSaved={async () => {
              // The name is compared again from the proof already on file: no new check, just a fresh context.
              await refresh();
              setFixingName(false);
              setExtrasLaunch(null);
            }}
          />
        ) : extrasLaunch ? (
          <DiditCheck
            titleId={titleId}
            embed={embed}
            initial={{ phase: "embedded", url: extrasLaunch.url, opId: extrasLaunch.opId }}
            decision={extrasDecision}
            settledOpId={settledCheckOp(ctx)}
            onExit={onClose ?? (() => go(back))}
            onFixName={() => setFixingName(true)}
            launch={async () => {
              if (!ctx.draft) return { ok: false, error: { code: "context_changed", message: "Your request changed. Start the check again." } };
              const res = await api.startChecks({ draftId: ctx.draft.id, expectedPolicyVersion: ctx.event.policyVersion, consent: requestConsent(ctx, true) });
              if (res.ok && "opId" in res.data) checksOp.current = res.data.opId;
              return res;
            }}
            refresh={async () => {
              const res = await refresh(checksOp.current ?? extrasLaunch.opId);
              if (res.ok && res.data.nextAction !== "extras") setExtrasLaunch(null);
            }}
            title="Verify with Didit"
            lead="The hosts of this event ask for one more check. Didit does it once and you reuse it for other events."
          />
        ) : (
          <Extras ctx={ctx} api={api} titleId={titleId} go={(url, opId) => ((checksOp.current = opId), setExtrasLaunch({ url, opId }))} onContext={setCtx} onNotice={setNotice} onFixName={() => setFixingName(true)} />
        ),
      );
    case "form":
      return frame(
        <RequestForm
          ctx={ctx}
          api={api}
          titleId={titleId}
          autoSubmit={autoSubmit && !again}
          attempt={{ get: () => attemptKey.current, set: (a) => void (attemptKey.current = a) }}
          onOptimistic={(expected) => {
            setOptimistic(true);
            setSubmitted(expected);
          }}
          onRollback={() => {
            setOptimistic(false);
            setSubmitted(null);
          }}
          onSubmitted={(reg) => {
            setOptimistic(false);
            setSubmitted(reg);
          }}
          onContext={setCtx}
          onNotice={setNotice}
          initialErrors={initialErrors}
          go={go}
        />,
      );
  }
}

/** The screens in the order a guest meets them: moving to an earlier one slides in from the left (going back). */
const SCREEN_ORDER = ["profile", "face-intro", "face", "extras", "extras-check", "extras-name", "form", "rejoin", "unavailable", "status", "result", "profile-steps"];

/**
 * "Request sent" / "You're in" / "You're on the waitlist", inside the modal. A request sent just now draws the success
 * check (a waitlist place keeps the clock); "Complete your profile" leads when the optional profile has gaps.
 */
export function JoinResult({
  titleId,
  eventName,
  registration,
  onClose,
  fresh = false,
  onCompleteProfile,
  backHref,
}: {
  titleId: string;
  eventName: string;
  registration: GuestRegistrationView;
  onClose?: () => void;
  fresh?: boolean;
  onCompleteProfile?: () => void;
  /** The event page, when there is no modal to close. */
  backHref?: string;
}) {
  const copy = resultCopy(registration.admission, eventName);
  const status = fresh && registration.admission !== "waitlisted" ? "success" : resultStatus(registration.admission);
  const mine = accountLinks.myEvent(registration.slug);
  return (
    <>
      <StepBody align="center">
        <div className={o.result} role="status">
          <FlowIcon status={status} />
          <Title id={titleId} size={24}>
            {copy.title}
          </Title>
          <Lead>{copy.body}</Lead>
        </div>
      </StepBody>
      {/* The quiet action over the primary one, which is always the last thing in the modal. */}
      <SheetFooter>
        {onCompleteProfile ? (
          <>
            {onClose ? (
              <Button size="lg" block variant="secondary" onClick={onClose}>
                Back to event
              </Button>
            ) : (
              <CtaLink href={backHref ?? mine} secondary>
                {backHref ? "Back to event" : "View my registration"}
              </CtaLink>
            )}
            <Button size="xl" block onClick={onCompleteProfile}>
              Complete your profile
            </Button>
          </>
        ) : (
          <>
            <CtaLink href={mine} secondary={Boolean(onClose)}>
              View my registration
            </CtaLink>
            {onClose ? (
              <Button size="xl" block onClick={onClose}>
                Back to event
              </Button>
            ) : null}
          </>
        )}
      </SheetFooter>
    </>
  );
}

/**
 * A registration on file and nothing to request: its status and the one thing to do next (the ticket, the hosts' email,
 * back to the event), with Withdraw / Leave the waitlist / Cancel my place as the quiet second action when allowed.
 */
export function RegistrationStatus({ titleId, copy, onClose, backHref }: { titleId: string; copy: ReturnType<typeof statusCopy>; onClose?: () => void; backHref: string }) {
  const primary = copy.primary;
  return (
    <div className={s.fill} data-registration-status="">
      <StepBody align="center">
        <div className={o.result} role="status">
          <FlowIcon status={copy.icon} />
          <Title id={titleId} size={24}>
            {copy.title}
          </Title>
          {copy.lead ? <Lead>{copy.lead}</Lead> : null}
        </div>
      </StepBody>
      <SheetFooter>
        {/* Leaving is a quiet text link, as on the event page and the ticket: never a third full-width pill. */}
        {copy.secondary ? (
          <a href={copy.secondary.href} className={s.quietAction}>
            {copy.secondary.label}
          </a>
        ) : null}
        {primary.kind === "close" ? (
          onClose ? (
            <Button size="xl" block onClick={onClose}>
              {primary.label}
            </Button>
          ) : (
            <CtaLink href={backHref}>{primary.label}</CtaLink>
          )
        ) : (
          <>
            {onClose ? (
              <Button size="lg" block variant="secondary" onClick={onClose}>
                Back to event
              </Button>
            ) : null}
            <CtaLink href={primary.href}>{primary.label}</CtaLink>
          </>
        )}
      </SheetFooter>
    </div>
  );
}

/* ── Answers and the one tap ───────────────────────────────────────────────────────────────────────────────── */

function RequestForm({
  ctx,
  api,
  titleId,
  go,
  autoSubmit,
  onSubmitted,
  onOptimistic,
  onRollback,
  attempt: sharedAttempt,
  onContext,
  onNotice,
  initialErrors,
}: {
  ctx: RequestContext;
  api: RequestApi;
  titleId: string;
  go: (url: string) => void;
  autoSubmit: boolean;
  onSubmitted: (registration: GuestRegistrationView) => void;
  /** A request again with nothing to ask: the result shows at once, the server's answer replaces it. */
  onOptimistic?: (expected: GuestRegistrationView) => void;
  onRollback?: () => void;
  /** Where the submission attempt lives (the parent keeps it across the optimistic remount). */
  attempt?: { get: () => Attempt | null; set: (a: Attempt) => void };
  onContext: (c: RequestContext) => void;
  onNotice: (n: string | null) => void;
  initialErrors?: AnswerErrors;
}) {
  const questions = questionsToAsk(ctx);
  const phoneAsked = askPhone(ctx);
  const [answers, setAnswers] = useState<Record<string, Answer | undefined>>({});
  // Questions the guest typed into: a fresh context never overwrites them.
  const typed = useRef(new Set<string>());
  const [phone, setPhone] = useState("");
  const [eventConsent, setEventConsent] = useState(false);
  const [errors, setErrors] = useState<AnswerErrors>(initialErrors ?? {});
  const [busy, setBusy] = useState(false);
  // One idempotency key per submission attempt: a pure retry of the same payload (a lost response, offline) reuses it
  // and gets the same registration back; a payload the guest or the server changed is a new attempt with a new key.
  const ownAttempt = useRef<Attempt | null>(null);
  const eventConsentId = useId();
  const oneTap = questions.length === 0 && !phoneAsked;
  const name = ctx.onboarding.profile.fullName?.trim();
  const again = rejoinOf(ctx);
  const quick = again && oneTap && !ctx.consent.eventConsentText ? again : null;
  const set = (id: string) => (a: Answer | undefined) => {
    typed.current.add(id);
    setAnswers((old) => ({ ...old, [id]: a }));
    if (errors[id]) setErrors((old) => ({ ...old, [id]: "" }));
  };

  // A fresh context (the hosts changed the form): keep what the guest typed for questions still asked, take the fresh
  // prefill for the rest, and drop answers (and errors) for questions that are gone.
  function reseed(fresh: RequestContext) {
    const ids = new Set(fresh.event.form.questions.map((q) => q.id));
    for (const id of typed.current) if (!ids.has(id)) typed.current.delete(id);
    setAnswers((old) => {
      const next: Record<string, Answer | undefined> = {};
      for (const id of ids) {
        const a = typed.current.has(id) ? old[id] : fresh.prefill.answers[id];
        if (a !== undefined) next[id] = a;
      }
      return next;
    });
    // Phone and consent follow the fresh form too: drop a phone the form no longer asks for, and ask for consent again
    // when the host changed its text (consent to old wording is not consent).
    const phoneStillAsked = askPhone(fresh);
    if (!phoneStillAsked) setPhone("");
    if (fresh.consent.eventConsentText !== ctx.consent.eventConsentText) setEventConsent(false);
    setErrors((old) => Object.fromEntries(Object.entries(old).filter(([k]) => ids.has(k) || (k === "phone_number" && phoneStillAsked) || (k === "eventConsent" && Boolean(fresh.consent.eventConsentText)))));
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const found = validateAnswers(questions, answers, { mode: ctx.event.form.fields.phone_number, value: phone, asked: phoneAsked });
    if (ctx.consent.eventConsentText && !eventConsent) found.eventConsent = "Tick the box to continue";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    onNotice(null);
    const body = {
      draftId: ctx.draft?.id,
      expectedPolicyVersion: ctx.event.policyVersion,
      expectedFormVersion: ctx.event.formVersion,
      profileVersion: ctx.onboarding.profileVersion,
      application: buildApplication(ctx, answers, phone),
      consent: requestConsent(ctx, eventConsent),
      joinWaitlist: ctx.submitLabel === "Join waitlist",
    };
    const payload = JSON.stringify(body);
    const last = sharedAttempt ? sharedAttempt.get() : ownAttempt.current;
    const attempt = last && !last.fresh && last.payload === payload ? last : { key: newIdempotencyKey(), payload, fresh: false };
    if (sharedAttempt) sharedAttempt.set(attempt);
    else ownAttempt.current = attempt;
    if (quick && ctx.registration) onOptimistic?.(expectedRegistration(ctx.registration, quick));
    const res = await api.submit({ ...body, idempotencyKey: attempt.key });
    if (res.ok) {
      if (res.data.registration) return onSubmitted(res.data.registration);
      return go(safeNext(res.data.redirectTo, accountLinks.myEvent(ctx.event.slug)));
    }
    if (quick) onRollback?.();
    setBusy(false);
    // The server refused this payload (stale form, full event, invalid answers): whatever is sent next is a new attempt.
    if (res.error.code === "context_changed" || res.error.code === "capacity" || res.error.fields) attempt.fresh = true;
    if (res.error.code === "context_changed" && res.error.context) reseed(res.error.context);
    if (res.error.context) onContext(res.error.context);
    onNotice(
      res.error.code === "context_changed"
        ? "The hosts updated this event's questions. Check the form and send it again."
        : res.error.code === "checks_required"
          ? "One more check is needed first. Your answers are kept."
          : res.error.code === "capacity"
            ? "The last places just went. Join the waitlist instead?"
            : errorCopy(res.error),
    );
  }

  // Nothing left to ask and the guest asked for it in this tab: the request goes out on its own, once.
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || !canAutoSubmit(ctx, autoSubmit)) return;
    auto.current = true;
    void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmit, ctx]);

  if (quick) {
    const copy = rejoinCopy(quick, name);
    return (
      <form className={s.fill} onSubmit={submit} noValidate data-rejoin={quick.kind}>
        <StepBody align="center">
          <div className={o.result}>
            <Eyebrow>{copy.eyebrow}</Eyebrow>
            <Title id={titleId} size={24}>
              {copy.title}
            </Title>
            <Lead>{copy.lead}</Lead>
            {quick.rule ? (
              <p className={o.rule} data-rejoin-rule="">
                {quick.rule}
              </p>
            ) : null}
            <p className={o.disclosure}>{ctx.consent.text}</p>
          </div>
        </StepBody>
        <SheetFooter>
          <Button type="submit" size="xl" block loading={busy}>
            {busy ? "Sending…" : copy.action}
          </Button>
        </SheetFooter>
      </form>
    );
  }

  return (
    <form className={cx(s.form, s.fill)} onSubmit={submit} noValidate>
      <StepBody>
        <Eyebrow>{oneTap ? "EVERYTHING IS READY" : "LAST STEP"}</Eyebrow>
        <Title id={titleId} size={22}>
          {ctx.submitLabel}
        </Title>
        {oneTap ? (
          <Lead>{`${name ? `${name}, your` : "Your"} profile and face check are done. Send your request in one tap.`}</Lead>
        ) : (
          <Lead>{questions.length ? "The hosts have a question or two. Everything else comes from your profile." : "One detail for the hosts. Everything else comes from your profile."}</Lead>
        )}
        {questions.map((q) => (
          <QuestionField key={q.id} q={q} value={answers[q.id]} onChange={set(q.id)} error={errors[q.id]} disabled={busy} />
        ))}
        {phoneAsked ? (
          <TextField
            name="phone_number"
            label={ctx.event.form.fields.phone_number === "optional" ? "Phone · optional" : "Phone"}
            size="xl"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+34 600 112 233"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone_number}
            hint="Shared with the hosts for event logistics."
            readOnly={busy}
            required={ctx.event.form.fields.phone_number === "required"}
          />
        ) : null}
        <RowGroup
          title="SHARED WITH THE HOSTS"
          rows={[
            { key: "profile", label: name || ctx.onboarding.email.address, detail: [ctx.onboarding.profile.headline, ctx.onboarding.profile.company].filter(Boolean).join(" · ") || "Your profile", action: <MetGlyph met /> },
            ...ctx.badges.filter((b) => b.state === "verified").map((b) => ({ key: b.check, label: b.label, detail: "Verified", action: <MetGlyph met /> })),
          ]}
        />
        {ctx.consent.eventConsentText ? (
          <div className={s.consent}>
            <Checkbox id={eventConsentId} name="eventConsent" size="lg" checked={eventConsent} invalid={Boolean(errors.eventConsent)} onChange={(e) => setEventConsent(e.target.checked)} />
            <label htmlFor={eventConsentId}>{ctx.consent.eventConsentText}</label>
          </div>
        ) : null}
        {errors.eventConsent ? (
          <p className={s.consentError} role="alert">
            {errors.eventConsent}
          </p>
        ) : null}
        <p className={o.disclosure}>{ctx.consent.text}</p>
      </StepBody>
      <SheetFooter>
        <Button type="submit" size="xl" block loading={busy}>
          {busy ? "Sending…" : ctx.submitLabel}
        </Button>
      </SheetFooter>
    </form>
  );
}

type Attempt = { key: string; payload: string; fresh: boolean };

/** A v4 UUID; outside a secure context (no randomUUID) still unique per attempt. */
const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((c === "x" ? Math.random() * 16 : (Math.random() * 4) | 8) | 0).toString(16));

function QuestionField({ q, value, onChange, error, disabled }: { q: Question; value: Answer | undefined; onChange: (a: Answer | undefined) => void; error?: string; disabled: boolean }) {
  const id = useId();
  const label = q.required ? q.label : `${q.label} · optional`;
  switch (q.kind) {
    case "short":
      return <TextField name={q.id} label={label} size="xl" maxLength={300} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} error={error} readOnly={disabled} required={q.required} />;
    case "url":
      return <TextField name={q.id} label={label} size="xl" inputMode="url" placeholder="https://" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} error={error} readOnly={disabled} required={q.required} />;
    case "long":
      return <Textarea name={q.id} label={label} size="xl" rows={4} maxLength={2000} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} error={error} readOnly={disabled} required={q.required} />;
    case "yes_no":
    case "single": {
      const opts = q.kind === "yes_no" ? [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] : q.options;
      const current = q.kind === "yes_no" ? (value === true ? "yes" : value === false ? "no" : "") : typeof value === "string" ? value : "";
      return (
        <fieldset className={s.group} aria-describedby={error ? `${id}-err` : undefined} disabled={disabled}>
          <legend className={cx(o.legend, o.questionLegend)}>{label}</legend>
          <div className={s.box}>
            {opts.map((opt) => (
              <label key={opt.id} className={s.row}>
                <input className={s.radioInput} type="radio" name={q.id} value={opt.id} checked={current === opt.id} onChange={() => onChange(q.kind === "yes_no" ? opt.id === "yes" : opt.id)} required={q.required} />
                <span className={s.rowText}>
                  <span className={cx(s.rowLabel, s.rowLabelRegular)}>{opt.label}</span>
                </span>
                <span className={s.radioGlyph} aria-hidden="true" />
              </label>
            ))}
          </div>
          {error ? (
            <p id={`${id}-err`} className={s.codeError} role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>
      );
    }
    case "multi": {
      const current = Array.isArray(value) ? value : [];
      return (
        <fieldset className={s.group} aria-describedby={error ? `${id}-err` : undefined} disabled={disabled}>
          <legend className={cx(o.legend, o.questionLegend)}>{label}</legend>
          <div className={s.box}>
            {q.options.map((opt) => (
              <label key={opt.id} className={s.row}>
                <Checkbox name={q.id} value={opt.id} checked={current.includes(opt.id)} onChange={(e) => onChange(e.target.checked ? [...current, opt.id] : current.filter((x) => x !== opt.id))} />
                <span className={s.rowText}>
                  <span className={cx(s.rowLabel, s.rowLabelRegular)}>{opt.label}</span>
                </span>
              </label>
            ))}
          </div>
          {error ? (
            <p id={`${id}-err`} className={s.codeError} role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>
      );
    }
  }
}
