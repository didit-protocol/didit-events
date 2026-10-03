/**
 * v5 re-join: the words and the one primary action for every state a guest can reach the join modal in, derived from
 * the server's `RequestContext` (its `availability` and the registration's `rejoin`). Pure, so the table-driven test
 * pins (registration × account × event) → screen + primary action without rendering, and the modal only renders it.
 */
import type { GuestRegistrationView, Rejoin, RequestContext } from "@didit-events/core/contracts/event-model";
import { rejoinCopy } from "./rejoin-words";
import { accountLinks } from "../links";
import { initialFacePhase, type JoinInitial } from "./machine";

export { rejoinCopy, type RejoinCopy } from "./rejoin-words";

export type StatusPrimary = { kind: "ticket" | "status"; label: string; href: string } | { kind: "contact"; label: string; href: string } | { kind: "close"; label: string };
export interface StatusCopy {
  title: string;
  lead: string;
  icon: "success" | "pending" | "info" | "warning";
  primary: StatusPrimary;
  /** Withdraw / leave the waitlist, when the server allows it. */
  secondary?: { label: string; href: string };
}

const close: StatusPrimary = { kind: "close", label: "Back to event" };
const contact: StatusPrimary = { kind: "contact", label: "Email the hosts", href: accountLinks.contactEvents() };

/** A registration on file and no request to send: its status, what is possible, never a dead button. */
export function statusCopy(reg: GuestRegistrationView, eventName: string): StatusCopy {
  const r = reg.rejoin;
  const mine = accountLinks.myEvent(reg.slug);
  const withdraw = reg.withdrawal.allowed ? { label: reg.admission === "waitlisted" ? "Leave the waitlist" : reg.admission === "approved" ? "Cancel my place" : "Withdraw request", href: reg.admission === "pending" ? accountLinks.withdraw(reg.slug) : accountLinks.cancel(reg.slug) } : undefined;
  switch (r.kind) {
    case "checked_in":
      return { title: "You're checked in", lead: `Enjoy ${eventName}.`, icon: "success", primary: { kind: "ticket", label: "View my registration", href: mine } };
    case "approved":
      return { title: "You're in", lead: `See you at ${eventName}. At the door, just look at the screen: your face is your ticket.`, icon: "success", primary: { kind: "ticket", label: "View my ticket", href: mine }, secondary: withdraw };
    case "pending":
      return { title: "Your request is in", lead: "The hosts review every request. We email you as soon as they decide.", icon: "pending", primary: close, secondary: withdraw };
    case "waitlisted":
      return { title: "You're on the waitlist", lead: `${reg.waitlistPosition ? `You are number ${reg.waitlistPosition} in line. ` : ""}If a place opens up, we email you straight away.`, icon: "pending", primary: close, secondary: withdraw };
    case "cancelled_by_host":
      return { title: "The hosts cancelled your place", lead: r.rule ?? "", icon: "info", primary: contact };
    case "revoked":
      return { title: "Your place was withdrawn", lead: r.rule ?? "", icon: "info", primary: contact };
    case "rejected":
      return { title: "The hosts could not offer you a place", lead: r.rule ?? "", icon: "info", primary: r.blockedBy === "blocked" || r.blockedBy === "once" ? contact : close };
    case "invited":
    case "cancelled":
      return { title: "You cancelled your place", lead: r.rule ?? "", icon: "info", primary: r.blockedBy === "once" ? contact : close };
    case "withdrew":
      return { title: "You withdrew your request", lead: r.rule ?? "", icon: "info", primary: r.blockedBy === "once" ? contact : close };
  }
}

/** No request can go out (and there is no registration that explains why): the reason in one screen. */
export function closedCopy(availability: RequestContext["availability"]): { title: string; lead: string } {
  switch (availability) {
    case "started":
      return { title: "The event has started", lead: "Requests closed when the doors opened. Subscribe to hear about the next Didit event first." };
    case "ended":
      return { title: "This event has ended", lead: "Find the next Didit event on the calendar." };
    case "cancelled":
      return { title: "This event was cancelled", lead: "The hosts cancelled it. Find another Didit event on the calendar." };
    case "full":
      return { title: "This event is full", lead: "All places are taken and there is no waitlist. Subscribe to hear about the next one first." };
    case "invite_only":
      return { title: "This event is invite only", lead: "Places come with an invitation from the hosts. Use the link in your invitation email." };
    default:
      return { title: "Requests are closed", lead: "This event is not taking requests right now. Subscribe to hear about the next Didit event first." };
  }
}

export type JoinScreen =
  | "sign_in" | "closed" | "deleting" | "account_unavailable"
  | "profile" | "face" | "face_intro" | "extras" | "form" | "rejoin" | "status";

/**
 * The first screen the modal shows for a server-rendered initial state and its one primary action (null: the screen
 * has its own form, or nothing to do). The server renders this, so the modal never flashes another step on open.
 */
export function joinScreen(initial: JoinInitial): { screen: JoinScreen; primary: string | null } {
  switch (initial.kind) {
    case "signed_out":
      return initial.requestsOpen ? { screen: "sign_in", primary: "Continue with Google" } : { screen: "closed", primary: "Back to event" };
    case "deleting":
      return { screen: "deleting", primary: "Keep my account" };
    case "unavailable":
      return { screen: "account_unavailable", primary: "Back to event" };
    case "signed_in":
      break;
  }
  const ctx = initial.ctx;
  const again = rejoinOf(ctx);
  switch (ctx.nextAction) {
    case "status":
      return { screen: "status", primary: ctx.registration ? statusCopy(ctx.registration, ctx.event.name).primary.label : "Back to event" };
    case "unavailable":
      return { screen: "closed", primary: "Back to event" };
    case "profile":
      return { screen: "profile", primary: "Continue" };
    case "face":
      // A guest requesting again goes straight to the check (expired, in review or declined); a new one reads the intro first.
      return !again && initialFacePhase(ctx.onboarding).phase === "starting" ? { screen: "face_intro", primary: "Next" } : { screen: "face", primary: null };
    case "extras":
      return { screen: "extras", primary: null };
    case "answers":
      return { screen: "form", primary: ctx.submitLabel };
    case "submit":
      return again && oneTap(ctx) ? { screen: "rejoin", primary: rejoinCopy(again).action } : { screen: "form", primary: ctx.submitLabel };
  }
}

/** The re-join decision when this context is a request again (the guest has a registration and may send a new one). */
export const rejoinOf = (ctx: Pick<RequestContext, "registration">): Rejoin | null => (ctx.registration?.rejoin.canRequest ? ctx.registration.rejoin : null);

/** Nothing to type: no unanswered question (required or optional), no phone to add, no host consent text. */
export const oneTap = (ctx: RequestContext) =>
  ctx.missingQuestions.length === 0 && ctx.event.form.questions.every((q) => q.required || ctx.prefill.answers[q.id] !== undefined) && !(ctx.event.form.fields.phone_number !== "off" && !ctx.prefill.fields.phone_number) && !ctx.consent.eventConsentText;

/** The registration the result screen shows the moment the guest taps (optimistic; the server's answer replaces it). */
export function expectedRegistration(reg: GuestRegistrationView, r: Rejoin): GuestRegistrationView {
  return { ...reg, admission: r.outcome ?? "pending", rejoin: { ...r, kind: r.outcome === "approved" ? "approved" : r.outcome === "waitlisted" ? "waitlisted" : "pending", canRequest: false, blockedBy: null }, canReapply: false };
}
