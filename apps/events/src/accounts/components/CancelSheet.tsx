import type { PublicEvent } from "../../public/types";
import { accountLinks } from "../links";
import type { CancelFormState, CancelMode } from "../types";
import { CancelConfirmForm, CancelForm, type CancelAction } from "./CancelForm";
import { Callout, CtaLink, FlowIcon, GuestScreen, Lead, Title } from "./Screen";
import a from "./Account.module.css";

export type { CancelAction };

export interface CancelSheetProps {
  event: PublicEvent;
  mode: Exclude<CancelMode, { mode: "started" }> | { mode: "confirm" };
  action: CancelAction;
  initial?: CancelFormState;
  /** Frame gallery: the focus look on the note (U-27). */
  focusNote?: boolean;
}

/** "in less than an hour" · "in 1 hour" · "in 9 hours" (whole hours, rounded on the server). */
export const startsIn = (hours: number) => {
  const h = Math.max(0, Math.round(hours));
  return h < 1 ? "in less than an hour" : `in ${h} ${h === 1 ? "hour" : "hours"}`;
};

/**
 * Cancel a place (05 U-26…U-28: reason required, late flag under 24 h), withdraw a pending request (U-30, reason
 * optional) or leave the waitlist, as a bottom sheet over the event. `confirm` is the plain 04 R-26 confirmation.
 * Server-rendered; only the forms (CancelForm.tsx) are client components.
 */
export function CancelSheet({ event, mode, action, initial, focusNote }: CancelSheetProps) {
  const titleId = "cancel-title";
  const keep = accountLinks.myEvent(event.slug);

  if (mode.mode === "confirm") {
    return (
      <div className={a.sheetHost}>
        <GuestScreen header="none" sheet={{ event, variant: "flow" }} labelledBy={titleId} topLabel={event.title}>
          <FlowIcon status="warning" />
          <Title id={titleId} size={22}>
            Cancel your place?
          </Title>
          <Lead>Your place goes to the next person on the waitlist. You can request again while places last.</Lead>
          <CancelConfirmForm
            slug={event.slug}
            action={action}
            initial={initial}
            secondary={
              <CtaLink href={keep} secondary>
                Keep my place
              </CtaLink>
            }
          />
        </GuestScreen>
      </div>
    );
  }

  const cancel = mode.mode === "cancel";
  const withdraw = mode.mode === "withdraw";
  const title = cancel ? "Cancel your place?" : withdraw ? "Withdraw your request?" : "Withdraw from the waitlist?";
  const body = cancel
    ? "Your place goes to the next person on the waitlist."
    : withdraw
      ? "The hosts have not decided yet. You can request again while registration is open."
      : "You give up your spot on the waitlist. You can request again while registration is open.";
  const late = cancel && mode.late;
  return (
    <div className={a.sheetHost}>
      <GuestScreen header="events" sheet={{ event, variant: "account" }} labelledBy={titleId} topLabel={event.title}>
        <Title id={titleId} size={22}>
          {title}
        </Title>
        {late ? null : <Lead>{body}</Lead>}
        {late ? (
          <Callout tone="warning" live={false}>
            {`The event starts ${startsIn(mode.hoursToStart)}. Late cancellations are fine, but please let us know, it helps us plan food and drinks.`}
          </Callout>
        ) : null}
        <CancelForm
          slug={event.slug}
          mode={mode.mode}
          action={action}
          initial={initial}
          focusNote={focusNote}
          secondary={
            <CtaLink href={keep} secondary>
              {cancel ? "Keep my place" : withdraw ? "Keep my request" : "Stay on the waitlist"}
            </CtaLink>
          }
        />
      </GuestScreen>
    </div>
  );
}
