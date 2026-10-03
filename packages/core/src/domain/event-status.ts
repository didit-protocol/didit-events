import type { DomainEvent } from "./services.ts";

/** Requests use the clock immediately; the scheduler persists the same transitions later. */
export function eventStatus(event: Pick<DomainEvent, "status" | "startsAt" | "endsAt">, now = new Date()): DomainEvent["status"] {
  if (event.status !== "published" && event.status !== "live") return event.status;
  if (now >= event.endsAt) return "ended";
  return event.status === "published" && now >= event.startsAt ? "live" : event.status;
}
