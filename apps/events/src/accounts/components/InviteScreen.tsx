import type { InviteView } from "../types";
import { accountLinks } from "../links";
import { AuthChoices } from "./Auth";
import { ActionButton, CtaLink, EventChip, Eyebrow, FlowIcon, Foot, GuestScreen, Lead, SecuredByDidit, Spacer, Title } from "./Screen";

/**
 * A direct invite /i/[token] (05 U-24, U-25): bound to one email (C10). Signed out: sign in to accept. Signed in as
 * that email: accept (no approval, straight to verification R-10). Signed in as someone else: switch accounts.
 */
export function InviteScreen({ view, token, accept, initials }: { view: InviteView; token: string; accept: (form: FormData) => Promise<void>; initials?: string }) {
  const here = accountLinks.invite(token);
  if (view.state === "not_found" || view.state === "expired") {
    return (
      <GuestScreen header="events" labelledBy="invite-title">
        {view.state === "expired" ? <EventChip event={view.event} /> : null}
        <FlowIcon status="warning" />
        <Title id="invite-title">{view.state === "expired" ? "This invite has expired" : "We can’t find this invite"}</Title>
        <Lead>Ask the host for a new one, or request a place yourself.</Lead>
        {/* A dead end: its one action follows the message instead of sitting at the bottom of an empty screen. */}
        <CtaLink href={view.state === "expired" ? accountLinks.register(view.event.slug) : accountLinks.calendar()}>{view.state === "expired" ? "Request to join" : "Explore events"}</CtaLink>
      </GuestScreen>
    );
  }
  if (view.state === "wrong_account") {
    return (
      <GuestScreen header="account" initials={initials} labelledBy="invite-title">
        <EventChip event={view.event} />
        <FlowIcon status="warning" />
        <Title id="invite-title">{`This invite is for ${view.email}`}</Title>
        <Lead>{`You are signed in as ${view.signedInAs}. Switch accounts to accept, or request a place yourself.`}</Lead>
        <Spacer />
        <CtaLink href={accountLinks.login(here, { switch: "1", email: view.email })}>Switch account</CtaLink>
        <CtaLink href={accountLinks.register(view.event.slug)} secondary>
          Request to join instead
        </CtaLink>
      </GuestScreen>
    );
  }
  const quote = "message" in view && view.message ? `“${view.message}” ` : "";
  return (
    <GuestScreen header={view.state === "accepted" ? "account" : "events"} initials={initials} labelledBy="invite-title">
      <EventChip event={view.event} />
      {"invitedBy" in view ? <Eyebrow>{`INVITED BY ${view.invitedBy.toUpperCase()}`}</Eyebrow> : null}
      <Title id="invite-title">You are invited</Title>
      <Lead>{`${quote}${view.skipApproval === false ? "The host will review your request. " : "No approval needed. "}${view.state === "accepted" ? view.skipApproval === false ? "Accept to request a place." : "Accept and verify once with Didit." : "Sign in to accept."}`}</Lead>
      {view.state === "signed_out" ? (
        <AuthChoices googleHref={accountLinks.google(here)} emailHref={accountLinks.login(here, { step: "email", email: view.email })} />
      ) : null}
      <Spacer />
      {view.state === "accepted" ? (
        <ActionButton action={accept} fields={{ token }} pendingLabel="Accepting…">
          Accept invite
        </ActionButton>
      ) : null}
      {view.state === "signed_out" ? (
        <>
          <Foot>{`Invite sent to ${view.email}`}</Foot>
          <SecuredByDidit />
        </>
      ) : null}
    </GuestScreen>
  );
}
