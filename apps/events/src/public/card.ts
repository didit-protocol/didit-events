import type { PillStatus } from "@didit-events/ui";
import type { StatusIconName, StatusTone } from "@didit-events/ui";
import { dayMonth, shortDate, time } from "./format";
import { links } from "./links";
import type { CardState, PublicEvent } from "./types";
import { greetingName } from "./viewer-name";

/** A card button: a navigation link, or one of the card's server actions. */
export type CardAction = { label: string; href: string; external?: boolean } | { label: string; action: "verify" | "subscribe" };

export interface CardContent {
  band: string;
  pill?: { label: string; status: PillStatus };
  icon?: { status: StatusTone; icon?: StatusIconName };
  title: string;
  body: string;
  /** Didit steps (Name, Email code, Selfie): done, current (in progress) or todo; `reached` darkens the label. */
  progress?: { label: string; bar: "done" | "current" | "todo"; reached: boolean }[];
  cta?: CardAction;
  cta2?: CardAction;
  foot?: { text: string; link?: { label: string; href: string } };
}

const STEPS = ["Name", "Email code", "Selfie"];

function progress(n: number, current: boolean): CardContent["progress"] {
  return STEPS.map((label, i) => ({ label, bar: i < n ? "done" : i === n && current ? "current" : "todo", reached: i <= n }));
}

/** P-02a–n: the registration card copy and actions for a state (design/04 AI Era Event, `cards`). */
export function cardContent(state: CardState, event: PublicEvent): CardContent {
  const tz = event.timeZone;
  const slug = event.slug;
  switch (state.kind) {
    case "signed_out":
      return {
        band: "Registration",
        title: "Approval required",
        body: "Create your account, verify you're human once, and get recognised at your next Didit event.",
        cta: { label: "Request to join", href: links.register(slug) },
        foot: { text: "Already registered? ", link: { label: "Sign in with your email.", href: links.signIn(links.event(slug)) } },
      };
    case "request":
      return {
        band: "Registration",
        title: "Approval required",
        body: `Your registration is subject to host approval. ${event.capacity} places.`,
        cta: { label: "Request to join", href: links.register(slug) },
      };
    case "pending":
      return {
        band: "Registration",
        pill: { label: "Pending", status: "link-sent" },
        icon: { status: "pending" },
        title: "Your request is in",
        body: `The hosts review every request. You will hear back by ${shortDate(state.replyBy, tz)} either way.`,
        cta2: { label: "Withdraw request", href: links.withdraw(slug) },
        foot: { text: `Requested ${dayMonth(state.requestedAt, tz)} · ${state.viewer.email}` },
      };
    case "approved":
      return {
        band: "You are approved",
        pill: { label: "Approved", status: "approved" },
        icon: { status: "info", icon: "check" },
        title: "One step left: verify with Didit",
        body: "Confirm your name and email, then take a quick selfie. 2 minutes, and it becomes your ticket.",
        progress: progress(0, false),
        cta: { label: "Verify my identity", action: "verify" },
        foot: { text: `Link expires ${shortDate(state.linkExpiresAt, tz)} · Handled by Didit · `, link: { label: "Cancel my place", href: links.cancel(slug) } },
      };
    case "verifying":
      return {
        band: "Verification",
        pill: { label: "Verifying", status: "verifying" },
        title: "You are halfway there",
        body: "Name and email are done. Finish with a selfie to get your face ticket.",
        progress: progress(state.stepsDone, true),
        cta: { label: "Continue verification", action: "verify" },
        foot: { text: "Cannot make it? ", link: { label: "Cancel my place", href: links.cancel(slug) } },
      };
    case "in_review":
      return {
        band: "Verification",
        pill: { label: "In review", status: "in-review" },
        icon: { status: "review" },
        title: "We are checking your verification",
        body: "A Didit reviewer is looking at it. Usually under 2 hours. We will email you.",
        foot: { text: "Cannot make it? ", link: { label: "Cancel my place", href: links.cancel(slug) } },
      };
    case "going":
      return {
        band: "You are going",
        pill: { label: "Going", status: "verified" },
        icon: { status: "success" },
        title: `You are in, ${greetingName(state.viewer)}`,
        body: "Your face is your ticket. At the door, just look at the screen.",
        cta: { label: "Add to calendar", href: links.ics(slug) },
        cta2: { label: "Get directions", href: event.venue.mapsUrl, external: true },
        foot: { text: "Cannot make it? ", link: { label: "Cancel my place", href: links.cancel(slug) } },
      };
    case "declined":
      return {
        band: "Verification",
        pill: { label: "Declined", status: "declined" },
        icon: { status: "error" },
        title: "We could not verify you",
        body: `The selfie did not pass the liveness check. Try again in good light, facing the camera. ${state.attemptsLeft} ${state.attemptsLeft === 1 ? "attempt" : "attempts"} left.`,
        cta: { label: "Try again", action: "verify" },
        foot: { text: "Cannot make it? ", link: { label: "Cancel my place", href: links.cancel(slug) } },
      };
    case "waitlist":
      return {
        band: "Registration",
        pill: { label: "Waitlist", status: "link-sent" },
        title: `You are #${state.position} on the waitlist`,
        body: "Places open up as people cancel. If one frees up the hosts can offer it to you, and we email you straight away.",
        cta2: { label: "Withdraw request", href: links.cancel(slug) },
      };
    case "not_approved":
      if (state.again?.label)
        return {
          band: "Registration",
          pill: { label: "Not approved", status: "declined" },
          title: "The hosts could not offer you a place",
          body: state.again.rule ?? "You can send the hosts one more request.",
          cta: { label: state.again.label, href: links.join(slug) },
        };
      return {
        band: "Registration",
        pill: { label: "Not approved", status: "declined" },
        // The host said no: never "full", which reads as if a place could still open.
        title: "Not approved this time",
        body: "The hosts could not offer you a place this time. Subscribe to hear about the next Didit event first.",
        cta: { label: "Subscribe to Didit Events", action: "subscribe" },
      };
    case "full":
      return {
        band: "Registration",
        pill: { label: "Full", status: "link-sent" },
        title: "Event is full",
        body: `All ${event.capacity} places are taken. Join the waitlist and we will let you know if a place opens.`,
        cta: { label: "Join waitlist", href: links.waitlist(slug) },
      };
    case "closed":
      return {
        band: "Registration",
        pill: { label: "Closed", status: "ended" },
        title: "Registration is closed",
        body: event.registrationClosesAt
          ? `Requests closed on ${shortDate(event.registrationClosesAt, tz)}. If you were approved, check your email for your verification link.`
          : "Requests closed when the event started. If you were approved, check your email for your verification link.",
      };
    case "checked_in":
      return {
        band: "Tonight",
        pill: { label: "Checked in", status: "checked-in" },
        icon: { status: "success" },
        title: `Welcome in, ${greetingName(state.viewer)}`,
        body: `Checked in at ${time(state.checkedInAt, tz)} at ${state.door}.${event.wifi ? ` Wi-Fi: ${event.wifi}.` : ""}`,
      };
    case "ended": {
      const joined = event.attended ?? event.going;
      return {
        band: "Past event",
        pill: { label: "Ended", status: "ended" },
        // "Thanks for coming" and the inbox promise are for a guest who attended; a visitor reads how it went (no "0 guests").
        title: state.attendance === "no_show" ? "We missed you" : state.attendance === "attended" ? "Thanks for coming" : "This event has ended",
        body: state.attendance ? state.attendance === "attended" ? "Your attendance is recorded. Panel recordings and photos are on their way to your inbox." : "Find another Didit event to join." : joined > 0 ? `${joined} ${event.audience ?? "guests"} joined. Find the next Didit event on the calendar.` : "Find the next Didit event on the calendar.",
        cta2: { label: "See photos", href: links.photos(slug) },
      };
    }
    case "cancelled": {
      if (state.by === "host" || state.by === "event")
        return {
          band: "Registration",
          pill: { label: "Cancelled", status: "ended" },
          title: state.by === "event" ? "This event was cancelled" : "The hosts cancelled your place",
          body: state.by === "event" ? "Find another Didit event on the calendar." : "If you think this is a mistake, email the hosts.",
          cta2: { label: state.by === "event" ? "Explore events" : "Email the hosts", href: state.by === "event" ? links.calendar() : links.contact() },
        };
      const withdrew = state.by === "withdrew";
      // v5: `again` null = no request again (once used, closed, full, blocked): the rule says why, and there is no button.
      if (state.again && !state.again.label)
        return { band: "Registration", pill: { label: withdrew ? "Withdrawn" : "Cancelled", status: "ended" }, title: withdrew ? "You withdrew your request" : "You cancelled your place", body: state.again.rule ?? "Find another Didit event on the calendar.", cta2: { label: "Explore events", href: links.calendar() } };
      return {
        band: "Registration",
        pill: { label: withdrew ? "Withdrawn" : "Cancelled", status: "ended" },
        title: withdrew ? "You withdrew your request" : "You cancelled your place",
        body: state.again?.rule ?? (withdrew ? "The hosts will not review it. Changed your mind? Request again while registration is open." : "Your place went to the next person on the waitlist. Changed your mind? Request again while places last."),
        cta: { label: state.again?.label ?? "Request again", href: links.register(slug) },
      };
    }
  }
}
