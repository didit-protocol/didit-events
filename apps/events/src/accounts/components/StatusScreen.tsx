import { CONTACT_EMAIL } from "../../config";
import type { ReactNode } from "react";
import { avatarInitial, type StatusIconName, type StatusTone } from "@didit-events/ui";
import { dayMonth, fullShortDate, shortDate, time } from "../../public/format";
import type { PublicEvent } from "../../public/types";
import { accountLinks } from "../links";
import { nameVerified, type GuestAccount, type GuestEventStatus } from "../types";
import { FaceTicket } from "./FaceTicket";
import {
  ActionButton,
  Callout,
  CtaLink,
  EventChip,
  Eyebrow,
  FlowIcon,
  Foot,
  GuestScreen,
  Lead,
  MetGlyph,
  RowGroup,
  SecuredByDidit,
  Spacer,
  StepList,
  Summary,
  Title,
  styles,
  type HeaderKind,
} from "./Screen";
import { hasStarted, withdrawalFor, withdrawalFromView } from "../withdrawal";
import { displayName, greetingName } from "../../public/viewer-name";
import { rejoinCopy } from "../join/rejoin-words";

type Action = (form: FormData) => Promise<void>;

export interface StatusActions {
  /** Start or continue the Didit hosted flow (C4). */
  verify: Action;
  /** U-42: selfie-only renewal (C16). */
  renew: Action;
  /** R-25: a fresh verification link. */
  newLink: Action;
  /** R-28: join the waitlist. */
  joinWaitlist: Action;
  /** R-24 / R-29: subscribe to the calendar. */
  subscribe: Action;
}

export interface StatusScreenProps {
  event: PublicEvent;
  account: GuestAccount;
  status: GuestEventStatus;
  actions: StatusActions;
  /** Request time: hides Withdraw/Cancel once doors are open. Frames omit it (always shown). */
  now?: Date;
}

const THREE_STEPS = [
  { title: "Confirm your name", hint: "As it appears on your ID" },
  { title: "Verify your email", hint: "Didit sends a 6-digit code" },
  { title: "Take a quick selfie", hint: "A 3-second liveness check" },
];

interface Spec {
  header: HeaderKind;
  chip: "flow" | "account" | null;
  eyebrow?: string;
  icon?: { status: StatusTone; icon?: StatusIconName };
  title: string;
  titleSize?: number;
  body?: ReactNode;
  content?: ReactNode;
  cta?: ReactNode;
  cta2?: ReactNode;
  foot?: ReactNode;
  /** A screen that opens a Didit verification: "Secured by Didit" under the CTAs. */
  secured?: boolean;
}

/**
 * The signed-in guest's page for one event (/me/events/[slug]): one screen per guest-facing status, with the copy of
 * design/04 (R-*) and design/05 (U-*). The status itself comes from the domain `displayStatus` (F1/B1).
 */
export function StatusScreen({ event, account, status, actions, now }: StatusScreenProps) {
  const spec = specFor(event, account, status, actions);
  const id = "status-title";
  // Every active status can be withdrawn (pending, waitlisted) or cancelled (an approved place in any sub-state).
  // At most one secondary button: when the status already has one (`cta2`), withdraw / cancel is the quiet text link.
  const withdrawal = status.registration ? withdrawalFromView(status.registration) : withdrawalFor(status.kind, event.slug, now ? hasStarted(event.startsAt, now) : false);
  const withdrawEl = withdrawal ? (
    spec.cta2 ? (
      <a href={withdrawal.href} className={styles.quietAction} data-withdrawal={withdrawal.kind}>
        {withdrawal.label}
      </a>
    ) : (
      <span data-withdrawal={withdrawal.kind} style={{ display: "contents" }}>
        <CtaLink href={withdrawal.href} secondary>
          {withdrawal.label}
        </CtaLink>
      </span>
    )
  ) : null;
  return (
    <GuestScreen header={spec.header} initials={initialsOf(account)} accountName={displayName(account)} account={account} labelledBy={id}>
      {spec.chip ? <EventChip event={event} variant={spec.chip} /> : null}
      {spec.eyebrow ? <Eyebrow>{spec.eyebrow}</Eyebrow> : null}
      {spec.icon ? <FlowIcon status={spec.icon.status} icon={spec.icon.icon} /> : null}
      <Title id={id} size={spec.titleSize}>
        {spec.title}
      </Title>
      {spec.body ? <Lead>{spec.body}</Lead> : null}
      {spec.content}
      <Spacer />
      {spec.cta}
      {spec.cta2}
      {withdrawEl}
      {spec.foot ? <Foot>{spec.foot}</Foot> : null}
      {spec.secured ? <SecuredByDidit /> : null}
    </GuestScreen>
  );
}

/** The avatar letter: first letter of the first name, else of the email (never empty for a real account). */
export const initialsOf = (a: Pick<GuestAccount, "firstName" | "lastName"> & { email?: string }) => avatarInitial(`${a.firstName} ${a.lastName}`, a.email);

function specFor(event: PublicEvent, account: GuestAccount, st: GuestEventStatus, actions: StatusActions): Spec {
  const tz = event.timeZone;
  const first = greetingName(account);
  const slug = { slug: event.slug };
  const backToEvent = <CtaLink href={accountLinks.event(event.slug)} secondary>Back to event</CtaLink>;
  const calendar = <CtaLink href={accountLinks.ics(event.slug)}>Add to calendar</CtaLink>;
  const directions = <CtaLink href={event.venue.mapsUrl} secondary>Get directions</CtaLink>;
  switch (st.kind) {
    case "checks_required": return {header:"events",chip:"account",title:"Your place is saved",body:<>Complete the required checks before the event: {st.missing.map(m=>`${m.check.replaceAll("_"," ")} (${m.reason.replaceAll("_"," ")})`).join(", ") || "complete your profile"}.</>,cta:<CtaLink href={`/me/events/${encodeURIComponent(event.slug)}/checks`}>Review required checks</CtaLink>};
    case "pending":
      if (st.justRequested)
        return {
          header: "account",
          chip: "account",
          icon: { status: "pending" },
          title: `Your request is in, ${first}`,
          body: `The hosts reply by ${shortDate(st.replyBy, tz)}. If approved, you verify once with Didit and walk in with your face.`,
          content: <Summary label="Your request" rows={[{ k: "Status", v: "Pending approval" }, { k: "Signed in with", v: st.via === "google" ? "Google" : "Email code" }, { k: "Confirmation", v: "Sent" }]} />,
          foot: <a href={accountLinks.myEvents()}>See all your events in My events</a>,
        };
      return {
        header: "account",
        chip: "account",
        icon: { status: "pending" },
        title: `Welcome back, ${first}`,
        body: `You already requested a place on ${dayMonth(st.requestedAt, tz)}. Nothing else to do for now.`,
        content: <Summary label="Your request" rows={[{ k: "Status", v: "Pending approval" }, { k: "Requested", v: `${dayMonth(st.requestedAt, tz)}, ${time(st.requestedAt, tz)}` }]} />,
        cta: <CtaLink href={accountLinks.myEvents()}>View my events</CtaLink>,
      };
    case "approved":
      return {
        header: "events",
        chip: "flow",
        eyebrow: "YOU ARE APPROVED",
        title: `One step left, ${first}`,
        body: "Verify once with Didit. On the night, the door recognises you. No ticket, no queue.",
        content: <StepList steps={THREE_STEPS} label="Verification steps" />,
        cta: (
          <ActionButton action={actions.verify} fields={slug} pendingLabel="Opening Didit…">
            Verify my identity
          </ActionButton>
        ),
        foot: "Your selfie is used only to recognise you at the door.",
        secured: true,
      };
    case "requirements_unmet":
      return { header: "account", chip: "account", icon: { status: "warning" }, title: "Complete the event requirements", body: "Your place is approved. Complete the missing verification steps before arriving.", cta: <ActionButton action={actions.verify} fields={slug} pendingLabel="Opening Didit…">Complete verification</ActionButton>, cta2: backToEvent, secured: true };
    case "verifying":
      return { header: "events", chip: "flow", title: "Continue your verification", body: "Finish the Didit steps to get your face ticket.", cta: <ActionButton action={actions.verify} fields={slug} pendingLabel="Opening Didit…">Continue verification</ActionButton>, cta2: backToEvent, secured: true };
    case "invited":
      return { header: "events", chip: "flow", title: "You are invited", body: "Open the invitation in your email to accept your place.", cta2: backToEvent };
    case "revoked": case "cancelled_by_host": case "event_cancelled": case "deleted":
      return { header: "events", chip: "flow", icon: { status: "neutral" }, title: st.kind === "event_cancelled" ? "This event has been cancelled" : st.kind === "deleted" ? "This account is no longer active" : st.kind === "revoked" ? "This invite is no longer active" : "The host cancelled your place", body: st.registration?.rejoin.rule ?? undefined, cta: <CtaLink href={accountLinks.calendar()}>Explore events</CtaLink> };
    case "going":
      if (st.reused)
        return {
          header: "account",
          chip: null,
          icon: { status: "success" },
          title: `You're in, ${first}`,
          titleSize: 30,
          body: "Approved. Your verified Didit profile covers everything this event needs, so there is nothing else to do.",
          content: <Summary label="Reused verification" rows={[{ k: "Name", v: "✓ Reused" }, { k: "Email", v: "✓ Reused" }, { k: "Selfie", v: "✓ Reused · face ticket ready" }]} />,
          cta: calendar,
          cta2: directions,
        };
      return {
        header: "events",
        chip: null,
        icon: { status: "success" },
        title: `You're in, ${first}`,
        titleSize: 30,
        body: "At the door, just look at the screen.",
        content: <FaceTicket event={event} guestName={displayName(account)} verifiedAt={st.verifiedAt} idVerified={nameVerified(account)} />,
        cta: calendar,
        cta2: directions,
      };
    case "in_review":
      return {
        header: "events",
        chip: "flow",
        icon: { status: "review" },
        title: "We are checking your verification",
        body: "A Didit reviewer is taking a look. Usually under 2 hours. We will email you.",
        cta2: backToEvent,
      };
    case "declined":
      return st.attemptsLeft > 0
        ? {
            header: "events",
            chip: "flow",
            icon: { status: "error" },
            title: "We could not verify you",
            body: "The selfie did not pass the liveness check. Try again in good light, facing the camera.",
            cta: (
              <ActionButton action={actions.verify} fields={slug} pendingLabel="Opening Didit…">
                Try again
              </ActionButton>
            ),
            foot: `${st.attemptsLeft} ${st.attemptsLeft === 1 ? "attempt" : "attempts"} left`,
            secured: true,
          }
        : {
            header: "events",
            chip: "flow",
            icon: { status: "error" },
            title: "We could not verify you",
            body: "You have used all attempts. The team can check it with you before the event.",
            cta: <CtaLink href={accountLinks.contactEvents()}>Email {CONTACT_EMAIL}</CtaLink>,
            cta2: backToEvent,
          };
    case "waitlisted":
      return {
        header: "events",
        chip: "flow",
        icon: { status: "pending" },
        title: "You are on the waitlist",
        body: `You are number ${st.position} in line. If a place opens the hosts can offer it to you, and we email you straight away.`,
      };
    case "not_approved":
      // v5: a request again is offered once, unless the hosts blocked it (the server's rejoin rule decides).
      if (st.registration?.rejoin.canRequest)
        return {
          header: "events",
          chip: "flow",
          icon: { status: "neutral" },
          title: "The hosts could not offer you a place",
          body: st.registration.rejoin.rule ?? undefined,
          cta: <CtaLink href={accountLinks.join(event.slug)}>{rejoinCopy(st.registration.rejoin).action}</CtaLink>,
          cta2: <CtaLink href={accountLinks.calendar()} secondary>Explore events</CtaLink>,
        };
      return {
        header: "events",
        chip: "flow",
        icon: { status: "neutral" },
        title: "Not approved this time",
        body: "The hosts could not offer you a place this time. You will be first to hear about the next Didit event.",
        cta: (
          <ActionButton action={actions.subscribe} fields={slug} pendingLabel="Subscribing…">
            Subscribe to Didit Events
          </ActionButton>
        ),
      };
    case "link_expired":
      return {
        header: "events",
        chip: "flow",
        icon: { status: "warning" },
        title: "This link has expired",
        body: "Verification links last 7 days. Request a fresh one and you are back on track.",
        cta: (
          <ActionButton action={actions.newLink} fields={slug} pendingLabel="Sending…">
            Send me a new link
          </ActionButton>
        ),
      };
    case "cancelled":
      if (st.justCancelled)
        return {
          header: "account",
          chip: "account",
          icon: { status: "neutral", icon: "check" },
          title: "You cancelled your place",
          body: "Thanks for letting us know. Your place went to the waitlist. Your Didit verification stays on your account for future events.",
          content: <Summary label="Cancellation" rows={[{ k: "Reason", v: st.reason ?? "Not given" }, { k: "Confirmation", v: "Sent" }]} />,
          cta: <CtaLink href={accountLinks.register(event.slug)}>Request again</CtaLink>,
          cta2: <CtaLink href={accountLinks.calendar()} secondary>Explore events</CtaLink>,
        };
      return {
        header: "events",
        chip: "flow",
        icon: { status: "neutral", icon: "check" },
        title: "You cancelled your place",
        body: `We sent a confirmation to ${account.email}. Your verification is kept by Didit for future events.`,
        cta: <CtaLink href={accountLinks.register(event.slug)}>Request again</CtaLink>,
        cta2: <CtaLink href={accountLinks.calendar()} secondary>Explore events</CtaLink>,
      };
    case "withdrawn": {
      // v5: the server's rejoin rule decides the words and whether "Request again" is there at all (no dead buttons).
      const again = st.registration?.rejoin;
      const left = again && (again.kind === "cancelled" || again.kind === "invited") ? "You cancelled your place" : "You withdrew your request";
      if (again && !again.canRequest)
        return { header: "account", chip: "account", icon: { status: "neutral", icon: "check" }, title: left, body: again.rule ?? undefined, cta: <CtaLink href={again.blockedBy === "once" ? accountLinks.contactEvents() : accountLinks.calendar()}>{again.blockedBy === "once" ? "Email the hosts" : "Explore events"}</CtaLink> };
      return {
        header: "account",
        chip: "account",
        icon: { status: "neutral", icon: "check" },
        title: again?.kind === "invited" ? "You were invited — rejoin" : left,
        body: again?.rule ?? "The hosts will not review it. You can request again while registration is open.",
        cta: <CtaLink href={accountLinks.join(event.slug)}>{again ? rejoinCopy(again).action : "Request again"}</CtaLink>,
        cta2: <CtaLink href={accountLinks.calendar()} secondary>Explore events</CtaLink>,
      };
    }
    case "full":
      return {
        header: "events",
        chip: "flow",
        icon: { status: "warning" },
        title: "This event is full",
        body: `All ${st.capacity} places are taken. Join the waitlist and we will let you know.`,
        cta: (
          <ActionButton action={actions.joinWaitlist} fields={slug} pendingLabel="Joining…">
            Join waitlist
          </ActionButton>
        ),
      };
    case "closed":
      return {
        header: "events",
        chip: "flow",
        icon: { status: "neutral" },
        title: "Registration is closed",
        body: `Requests closed ${shortDate(st.closedAt, tz)}. If you were approved, check your email for your verification link.`,
        cta2: (
          <ActionButton action={actions.subscribe} fields={slug} pendingLabel="Subscribing…" secondary>
            Subscribe to Didit Events
          </ActionButton>
        ),
      };
    case "checked_in":
      return {
        header: "events",
        chip: "flow",
        icon: { status: "success" },
        title: `Welcome in, ${first}`,
        body: `Checked in at ${time(st.at, tz)} at ${st.door}.`,
        content:
          st.wifi || st.next ? (
            <Callout tone="neutral" live={false}>
              {[st.wifi ? `Wi-Fi: ${st.wifi}` : null, st.next].filter(Boolean).join("\n")}
            </Callout>
          ) : null,
        cta2: <CtaLink href={`${accountLinks.event(event.slug)}#agenda`} secondary>See the agenda</CtaLink>,
      };
    case "ended":
      return {
        header: "events",
        chip: "flow",
        icon: { status: "neutral", icon: "check" },
        title: st.attendance === "no_show" ? "We missed you" : st.attendance === "none" ? "This event has ended" : "Thanks for coming",
        body: st.attendance ? st.attendance === "attended" ? "Your attendance is recorded. See you at the next event." : "Find another Didit event to join." : `${st.attended} ${st.audience} joined. Recordings of both panels arrive by email this week.`,
        cta: <CtaLink href={accountLinks.calendar()}>See upcoming Didit events</CtaLink>,
      };
    case "email_mismatch":
      return {
        header: "events",
        chip: "flow",
        icon: { status: "review" },
        title: "The team will review your verification",
        body: `You verified ${st.verifiedEmail}, but your invite is for ${st.invitedEmail}. The team will review it.`,
        cta2: (
          <ActionButton action={actions.verify} fields={{ ...slug, email: st.invitedEmail }} pendingLabel="Opening Didit…" secondary>
            Verify again with the invited email
          </ActionButton>
        ),
      };
    case "link_other_account":
      return {
        header: "events",
        chip: "flow",
        icon: { status: "warning" },
        title: "This link belongs to another guest",
        body: "Sign in with the account that was invited.",
        cta: <CtaLink href={accountLinks.login(accountLinks.myEvent(event.slug), { switch: "1" })}>Switch account</CtaLink>,
        cta2: backToEvent,
      };
    case "selfie_expired":
      return {
        header: "account",
        chip: "account",
        icon: { status: "warning" },
        title: "Refresh your selfie",
        titleSize: 26,
        body: "Your email is still verified and your profile is saved. Take a new selfie that meets this event’s requirements to get your face ticket.",
        content: (
          <RowGroup
            title="WHAT’S LEFT"
            rows={[
              { label: "Profile", detail: "Reused", action: <MetGlyph met /> },
              { label: "Email", detail: "Reused", action: <MetGlyph met /> },
              { label: "Selfie · liveness", detail: `Expired ${fullDate(st.expiredAt, tz)}`, action: <MetGlyph met={false} /> },
            ]}
          />
        ),
        cta: (
          <ActionButton action={actions.renew} fields={slug} pendingLabel="Opening Didit…">
            Take a new selfie
          </ActionButton>
        ),
        foot: "About 30 seconds",
        secured: true,
      };
  }
}

/** "1 Oct 2026" */
const fullDate = (iso: string, tz: string) => fullShortDate(iso, tz).replace(/^\w+ /, "");
