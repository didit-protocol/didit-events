/** Pure A-04 view model: tiles, funnel, banner, chart and feed from the overview data (frames pass a fixed clock). */
import type { OverviewData } from "./types";

export type TileTone = "positive" | "warning" | "neutral";
export interface Tile {
  label: string;
  value: string;
  delta: string;
  tone: TileTone;
}

export interface FunnelStep {
  label: string;
  value: number;
  pct: number;
}

export interface ChartBar {
  label: string;
  count: number;
  live: boolean;
}

export type OverviewPhase = "before" | "live" | "ended" | "cancelled";

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

const clock = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));

export function phaseOf(d: Pick<OverviewData, "status" | "startsAt" | "endsAt">, now: Date): OverviewPhase {
  // Cancelled wins over the clock: before or after its date, the event never took place.
  if (d.status === "cancelled") return "cancelled";
  if (d.status === "ended" || now.getTime() >= Date.parse(d.endsAt)) return "ended";
  if (d.status === "live" || now.getTime() >= Date.parse(d.startsAt)) return "live";
  return "before";
}

/**
 * Nobody at all: the A-04e empty state. Only when the event has no registration in any state (requested, waitlisted,
 * approved, declined, cancelled) and no open invitation; an event filled through the request link is not empty.
 */
export const isEmptyOverview = (d: OverviewData) => d.counts.registrations === 0 && d.counts.invited === 0;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const listJoin = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function tiles(d: OverviewData, phase: OverviewPhase): Tile[] {
  const c = d.counts;
  const doors = d.unknownDoors.length ? listJoin(d.unknownDoors) : "";
  // The guest list is the approved registrations (the Guests tab's number), however they came in: invited or by request.
  const waiting = c.pending ? plural(c.pending, "request pending", "requests pending") : c.invited ? plural(c.invited, "invite open", "invites open") : `${c.linksSent} links sent`;
  const guests: Tile = { label: "Guests", value: String(c.approved), delta: phase === "ended" ? "final" : waiting, tone: "neutral" };
  const verified: Tile = { label: "Verified", value: String(c.verified), delta: `${pct(c.verified, c.approved)}% of guests`, tone: "positive" };
  if (phase === "cancelled") {
    // No door and no no-shows: nobody was expected. Check-ins made before the cancellation still count.
    return [
      { ...guests, delta: "event cancelled" },
      verified,
      { label: "Checked in", value: String(c.checkedIn), delta: c.checkedIn ? "before it was cancelled" : "—", tone: "neutral" },
      { label: "Unknown faces", value: String(c.unknownFaces), delta: "—", tone: "neutral" },
    ];
  }
  if (phase === "before") {
    return [
      guests,
      verified,
      { label: "Checked in", value: "0", delta: "doors not open", tone: "neutral" },
      { label: "Still missing", value: "—", delta: "after doors open", tone: "neutral" },
      { label: "Unknown faces", value: String(c.unknownFaces), delta: "—", tone: "neutral" },
    ];
  }
  if (phase === "ended") {
    return [
      guests,
      verified,
      { label: "Checked in", value: String(c.checkedIn), delta: `${pct(c.checkedIn, c.approved)}% of guests`, tone: "positive" },
      { label: "No-shows", value: String(Math.max(0, c.verified - c.checkedIn)), delta: "verified, never in", tone: "warning" },
      { label: "Unknown faces", value: String(c.unknownFaces), delta: doors ? (d.unknownDoors.length === 1 ? `all at ${doors}` : `at ${doors}`) : "—", tone: "neutral" },
    ];
  }
  return [
    guests,
    verified,
    { label: "Checked in", value: String(c.checkedIn), delta: `+${d.checkedInLast15} in last 15 min`, tone: d.checkedInLast15 > 0 ? "positive" : "neutral" },
    { label: "Still missing", value: String(Math.max(0, c.verified - c.checkedIn)), delta: "verified, not in", tone: "warning" },
    { label: "Unknown faces", value: String(c.unknownFaces), delta: doors ? `at ${doors}` : "—", tone: "neutral" },
  ];
}

export function funnel(d: OverviewData): FunnelStep[] {
  const c = d.counts;
  return [
    { label: "Approved", value: c.approved, pct: c.approved ? 100 : 0 },
    { label: "Link sent", value: c.linksSent, pct: pct(c.linksSent, c.approved) },
    { label: "Verified", value: c.verified, pct: pct(c.verified, c.approved) },
    { label: "Checked in", value: c.checkedIn, pct: pct(c.checkedIn, c.approved) },
  ];
}

/** "2h 14m" / "45m" until doors. */
export function untilLabel(from: Date, toIso: string): string {
  const m = Math.max(0, Math.round((Date.parse(toIso) - from.getTime()) / 60_000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function kioskLine(d: OverviewData): string {
  const on = d.doors.filter((k) => k.online);
  if (d.doors.length === 0) return "No kiosk is paired yet.";
  if (d.doors.length === 1) return `${d.doors[0]!.name} kiosk is paired and ${on.length ? "online" : "offline"}.`;
  return `${on.length} of ${d.doors.length} kiosks are online.`;
}

export function banner(d: OverviewData, phase: OverviewPhase, now: Date): { text: string; tone: "info" | "neutral" } | null {
  if (phase === "cancelled") {
    const reason = d.cancelReason?.trim();
    return { text: reason ? `This event was cancelled. Reason: ${reason}` : "This event was cancelled.", tone: "neutral" };
  }
  if (phase === "before") return { text: `Doors open in ${untilLabel(now, d.startsAt)}. ${kioskLine(d)}`, tone: "info" };
  if (phase === "ended") {
    const c = d.counts;
    return { text: `Ended at ${clock(d.endsAt, d.timeZone)}. ${c.checkedIn} of ${c.approved} guests checked in (${pct(c.checkedIn, c.approved)}%).`, tone: "neutral" };
  }
  return null;
}

/** 12 bars; the bucket containing `now` is blue while the event is live. */
export function chart(d: OverviewData, phase: OverviewPhase, now: Date): ChartBar[] {
  const t = now.getTime();
  return d.buckets.map((b) => {
    const start = Date.parse(b.start);
    return { label: clock(b.start, d.timeZone), count: b.count, live: phase === "live" && t >= start && t < start + 15 * 60_000 };
  });
}

export function peak(bars: ChartBar[]): string {
  const top = bars.reduce<ChartBar | null>((best, b) => (b.count > (best?.count ?? 0) ? b : best), null);
  return top ? `${top.count} at ${top.label}` : "—";
}

export const arrivalTime = (iso: string, tz: string) => clock(iso, tz);
