import type { CardState, PublicEvent, SimpleEventGate, Viewer } from "./types";

const passed = (iso: string | undefined, now: Date) => iso !== undefined && new Date(iso).getTime() <= now.getTime();

/** The event's gate at `now`: an event past its end is ended even if its stored status is still live (C26 note). */
export function eventGate(event: PublicEvent, now: Date): SimpleEventGate {
  if (event.lifecycle === "ended" || event.lifecycle === "cancelled" || passed(event.endsAt, now)) return "ended";
  // Same rule as the register route (registerGate): requests close at the deadline or when the event starts.
  if (event.registration === "invite_only" || passed(event.registrationClosesAt, now) || passed(event.startsAt, now)) return "closed";
  if (event.going >= event.capacity) return "full";
  return "open";
}

/**
 * The registration card for someone without a registration for this event: signed out (P-02a) or signed in
 * (P-01 request card), unless the event is ended, closed or full. A registered guest's card comes from the domain
 * `displayStatus` (F1/B1) instead.
 */
export function cardWithoutRegistration(event: PublicEvent, viewer: Viewer | null, now: Date): CardState {
  const gate = eventGate(event, now);
  if (gate === "ended") return { kind: "ended" };
  if (gate === "closed") return { kind: "closed" };
  if (gate === "full") return { kind: "full" };
  return viewer ? { kind: "request", viewer } : { kind: "signed_out" };
}
