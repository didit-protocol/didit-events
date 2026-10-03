import type { ApplicantsEvent } from "./types";

/**
 * AP-25: why the Requests tab says registration is closed, and whether "Reopen requests" can do anything about it.
 * Only a passed closing date can be reopened (clearing it opens the public page again). An event that has started,
 * ended, been cancelled or is still a draft stays closed whatever the closing date says, so the button is not offered.
 */
export function closedNote(event: Pick<ApplicantsEvent, "closed" | "closedOn">, pending: number): { text: string; reopen: boolean } {
  const decide = pending > 0 ? ` You can still decide on the ${pending} pending.` : "";
  switch (event.closed ?? "date") {
    case "started": return { text: `Requests closed when the event started and can’t be reopened.${decide}`, reopen: false };
    case "ended": return { text: `Requests are closed: the event has ended.${decide}`, reopen: false };
    case "cancelled": return { text: "Requests are closed: the event was cancelled.", reopen: false };
    case "draft": return { text: "Requests open when you publish the event.", reopen: false };
    default:
      // Never "closed on ." with an empty date.
      return { text: `${event.closedOn ? `Requests closed on ${event.closedOn}.` : "Requests are closed."} You can still decide on the ${pending} pending and invite people directly.`, reopen: true };
  }
}
