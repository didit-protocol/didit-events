"use client";

import { CONTACT_EMAIL } from "../../../config";

import { lazy, Suspense, useState } from "react";
import { actionCsrf } from "../../../auth/client";
import { accountLinks, safeNext } from "../../links";
import { httpOnboardingApi, type OnboardingApi } from "../../onboarding-api";
import { faceConsent, facePurpose, firstNameOf, type OnboardingView } from "../../onboarding";
import { CtaLink, FlowIcon, Lead, Spacer, Title, Callout } from "../Screen";
import type { DiditCheckProps } from "./DiditCheck";
import { JoinPath } from "./JoinAuth";
import { StepLoading } from "./StepLoading";
import { SecuredByDidit } from "../SecuredByDidit";

// Only the step the account needs downloads (the face step brings the Didit SDK loader).
const MissingProfile = lazy(() => import("../RequestSteps").then((m) => ({ default: m.MissingProfile })));
const DiditCheck = lazy(() => import("./DiditCheck").then((m) => ({ default: m.DiditCheck })));
const loading = <StepLoading />;

/**
 * The join flow without an event (a direct /onboarding link): the same steps as the modal — missing profile fields,
 * the face when the account has none — then "You're all set" and back to `returnTo`.
 */
export function OnboardingJoin({ initial, returnTo, api: apiProp, embed }: { initial: OnboardingView; returnTo: string; api?: OnboardingApi; embed?: DiditCheckProps["embed"] }) {
  const [api] = useState<OnboardingApi>(() => apiProp ?? httpOnboardingApi(actionCsrf));
  const [view, setView] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const titleId = "onboarding-title";
  const next = safeNext(returnTo, "/events");
  const refresh = async () => {
    const res = await api.refresh();
    if (res.ok) setView(res.data);
    return res;
  };

  switch (view.step) {
    case "email_required":
      return (
        <>
          <Title id={titleId}>Sign in to continue</Title>
          <Lead>Sign in with the same email and you pick up exactly where you left off.</Lead>
          <Spacer />
          <CtaLink href={accountLinks.login(`/onboarding?next=${encodeURIComponent(next)}`)}>Sign in</CtaLink>
          <SecuredByDidit />
        </>
      );
    case "unavailable":
      return (
        <>
          <Title id={titleId}>This account is not available</Title>
          <Lead>It is being deleted or was closed. If this is a mistake, email {CONTACT_EMAIL}.</Lead>
          <Spacer />
          <CtaLink href={accountLinks.calendar()}>Explore events</CtaLink>
          <SecuredByDidit />
        </>
      );
    case "profile_required":
      return (
        <>
          {notice ? <Callout tone="warning">{notice}</Callout> : null}
          <Suspense fallback={loading}>
            <MissingProfile onboarding={view} profileApi={api} titleId={titleId} onSaved={refresh} onNotice={setNotice} />
          </Suspense>
        </>
      );
    case "complete": {
      const first = firstNameOf(view);
      return (
        <>
          <FlowIcon status="success" />
          <Title id={titleId}>{first ? `You're all set, ${first}` : "You're all set"}</Title>
          <Lead>Requesting a place at any Didit event is now one tap, and the door recognises you.</Lead>
          <JoinPath done={2} next />
          <Spacer />
          <CtaLink href={next}>{next === "/events" || next === "/me/events" ? "Explore events" : "Continue"}</CtaLink>
        </>
      );
    }
    default:
      return (
        <Suspense fallback={loading}>
        <DiditCheck
          titleId={titleId}
          view={view}
          embed={embed}
          launch={() => api.startFace({ purpose: facePurpose(view), consent: faceConsent(), returnTo: "/onboarding" })}
          refresh={refresh}
          title="Verify you're human"
          lead="One quick selfie with Didit, once for every Didit event. At the door, just look at the screen."
        />
        </Suspense>
      );
  }
}
