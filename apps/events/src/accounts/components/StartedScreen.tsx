import type { PublicEvent } from "../../public/types";
import { accountLinks } from "../links";
import type { GuestAccount } from "../types";
import { CtaLink, EventChip, FlowIcon, GuestScreen, Lead, Spacer, Title } from "./Screen";
import { initialsOf } from "./StatusScreen";
import { displayName } from "../../public/viewer-name";

/** 05 U-31: cancellation closes when doors open. */
export function StartedScreen({ event, account }: { event: PublicEvent; account: GuestAccount }) {
  return (
    <GuestScreen header="account" initials={initialsOf(account)} accountName={displayName(account)} account={account} labelledBy="started-title">
      <EventChip event={event} />
      <FlowIcon status="info" />
      <Title id="started-title">The event has started</Title>
      <Lead>Cancellation closes when doors open. If you cannot make it, no action is needed. We mark no-shows automatically.</Lead>
      <Spacer />
      <CtaLink href={`${accountLinks.event(event.slug)}#agenda`} secondary>
        See the agenda
      </CtaLink>
    </GuestScreen>
  );
}
