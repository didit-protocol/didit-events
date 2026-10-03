/**
 * v5 re-join: the screen words and the one action for a request again. Dependency-free (type imports only) so the
 * status page, the event card and /me/events can name the action without pulling the join modal's code.
 */
import type { Rejoin } from "@didit-events/core/contracts/event-model";

export interface RejoinCopy {
  eyebrow: string;
  title: string;
  lead: string;
  action: string;
}

/** A guest with a registration on file who may request again: one calm screen, one tap. */
export function rejoinCopy(r: Rejoin, name?: string): RejoinCopy {
  const hi = name ? `${name}, your` : "Your";
  const action = r.outcome === "waitlisted" ? "Join the waitlist" : null;
  switch (r.kind) {
    case "invited":
      return { eyebrow: "WELCOME BACK", title: "You were invited — rejoin", lead: `You cancelled, but the hosts' invitation still stands. ${hi} profile and face check are ready.`, action: action ?? "Rejoin" };
    case "cancelled":
      return { eyebrow: "WELCOME BACK", title: "Request your place again", lead: `You cancelled your place. ${hi} profile and face check are ready, so asking again is one tap.`, action: action ?? "Request my place again" };
    case "rejected":
      return { eyebrow: "ONE MORE TRY", title: "Request again", lead: "The hosts could not offer you a place last time. You can send them one more request.", action: action ?? "Request again" };
    default:
      return { eyebrow: "WELCOME BACK", title: "Request again", lead: `You withdrew your request. ${hi} profile and face check are ready, so it is one tap.`, action: action ?? "Request again" };
  }
}
