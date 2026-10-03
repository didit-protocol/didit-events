"use client";

import { CONTACT_EMAIL } from "../../../config";

import { Button } from "@didit-events/ui";
import type { GuestRegistrationView } from "@didit-events/core/contracts/event-model";
import type { PublicEvent } from "../../../public/types";
import type { InAppInfo } from "../../../auth/inapp";
import { accountLinks, joinHref } from "../../links";
import { hasJoinIntent } from "../../join/intent";
import type { JoinInitial } from "../../join/machine";
import { RequestJoinContent, type RequestJoinProps } from "../RequestJoinContent";
import { JoinAuth, type SignInAction } from "./JoinAuth";
import { KeepAccountPanel, type KeepAction } from "../KeepAccount";
import { SheetFooter } from "../SheetFooter";
import { StepBody } from "./Step";
import j from "./Join.module.css";

export interface JoinFlowProps {
  event: PublicEvent;
  initial: JoinInitial;
  signIn: SignInAction;
  /** The visitor is inside an in-app browser (set by the server from the User-Agent). */
  inApp?: InAppInfo | null;
  onClose?: () => void;
  onRegistered?: (registration: GuestRegistrationView) => void;
  /** The /me/profile photo actions for the profile step after a request. */
  photo?: RequestJoinProps["photo"];
  /** Test seams. */
  requestProps?: Pick<RequestJoinProps, "api" | "profileApi" | "embed" | "navigate">;
  autoSubmit?: boolean;
  /** v5: "Keep my account" while the account is in its deletion grace period (then the flow continues in place). */
  keepAccount?: KeepAction;
}

/** The modal's content: sign in when signed out, else the request flow (only what is missing, then the request). */
export function JoinFlow({ event, initial, signIn, inApp, onClose, onRegistered, photo, requestProps, autoSubmit, keepAccount }: JoinFlowProps) {
  const titleId = "request-title";
  // Signed in but the email was never proven (older accounts): the email code step is the missing piece, not an empty profile form.
  const unprovenEmail = initial.kind === "signed_in" && !initial.ctx.onboarding.email.verified;
  if (initial.kind === "signed_out" || unprovenEmail) {
    if (initial.kind === "signed_out" && !initial.requestsOpen) return <Closed titleId={titleId} onClose={onClose} />;
    const next = joinHref(event.slug);
    return <JoinAuth action={signIn} next={next} googleHref={accountLinks.google(next)} titleId={titleId} eventName={event.title} inApp={inApp} />;
  }
  if (initial.kind === "deleting" && keepAccount) {
    return (
      <KeepAccountPanel
        titleId={titleId}
        graceUntil={initial.graceUntil}
        action={keepAccount}
        eventName={event.title}
        secondary={
          onClose ? (
            <Button size="lg" block variant="secondary" onClick={onClose}>
              Not now
            </Button>
          ) : null
        }
      />
    );
  }
  if (initial.kind === "unavailable" || initial.kind === "deleting") {
    return (
      <>
        <StepBody>
          <h2 id={titleId} className={j.title}>
            This account can&apos;t request places
          </h2>
          <p className={j.lead}>It is being deleted or was closed. If this is a mistake, email {CONTACT_EMAIL}.</p>
        </StepBody>
        {onClose ? (
          <SheetFooter>
            <Button size="lg" block variant="secondary" onClick={onClose}>
              Back to event
            </Button>
          </SheetFooter>
        ) : null}
      </>
    );
  }
  return (
    <RequestJoinContent
      event={event}
      initial={initial.ctx}
      autoSubmit={autoSubmit ?? hasJoinIntent(event.slug)}
      onRegistered={onRegistered}
      onClose={onClose}
      photo={photo}
      {...requestProps}
    />
  );
}

function Closed({ titleId, onClose }: { titleId: string; onClose?: () => void }) {
  return (
    <>
      <StepBody>
        <h2 id={titleId} className={j.title}>
          Requests are closed
        </h2>
        <p className={j.lead}>This event is not taking requests right now. Subscribe to hear about the next Didit event first.</p>
      </StepBody>
      {onClose ? (
        <SheetFooter>
          <Button size="lg" block variant="secondary" onClick={onClose}>
            Back to event
          </Button>
        </SheetFooter>
      ) : null}
    </>
  );
}
