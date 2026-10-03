"use client";

import { useState, type ComponentProps } from "react";
import { OnboardingJoin } from "./components/join/OnboardingJoin";
import { RequestJoin, type RequestJoinProps } from "./components/RequestJoin";
import { JoinResult } from "./components/RequestJoinContent";
import { ProfileSteps, type ProfileStepsProps } from "./components/join/ProfileSteps";
import type { GuestRegistrationView } from "@didit-events/core/contracts/event-model";
import { EventChip, GuestScreen } from "./components/Screen";
import type { PublicEvent } from "../public/types";
import { fixtureOnboardingApi } from "./onboarding-fixtures";
import { fixtureRequestApi } from "./request-fixtures";
import type { EmbeddedHandlers } from "./join/sdk";

/** Frames never load the Didit SDK: the embedded container stays a placeholder. */
const noEmbed = async (_url: string, _id: string, _handlers: EmbeddedHandlers) => () => {};

/** The frame gallery injects transports; production components never import fixture modules. */
export function DemoOnboardingJoin({ initial, ...props }: Omit<ComponentProps<typeof OnboardingJoin>, "api" | "embed">) {
  const [api] = useState(() => fixtureOnboardingApi({ views: [initial] }));
  return <OnboardingJoin {...props} initial={initial} api={api} embed={noEmbed} />;
}
export function DemoRequestJoin({initial,...props}:Omit<RequestJoinProps,"api"|"profileApi">) {
  const [api]=useState(()=>fixtureRequestApi({contexts:[initial]}));
  const [profileApi]=useState(()=>fixtureOnboardingApi({views:[initial.onboarding]}));
  return <RequestJoin {...props} initial={initial} api={api} profileApi={profileApi} embed={noEmbed} />;
}

/** After a request: "Request sent" with "Complete your profile" (Q-10), a profile screen (Q-11), "Profile done" (Q-12). */
export function DemoProfileSteps({ event, registration, at, ...props }: Omit<ProfileStepsProps, "profileApi" | "titleId" | "backHref" | "initialStep"> & { event: PublicEvent; registration: GuestRegistrationView; at: "result" | number | "done" }) {
  const [profileApi] = useState(() => fixtureOnboardingApi({ views: [props.onboarding] }));
  return (
    <GuestScreen header="events" sheet={{ event, variant: "flow" }} labelledBy="request-title">
      <EventChip event={event} variant="flow" />
      {at === "result" ? (
        <JoinResult titleId="request-title" eventName={event.title} registration={registration} fresh onCompleteProfile={() => {}} onClose={() => {}} />
      ) : (
        <ProfileSteps {...props} titleId="request-title" profileApi={profileApi} backHref={`/e/${event.slug}`} initialStep={at} onClose={() => {}} />
      )}
    </GuestScreen>
  );
}
