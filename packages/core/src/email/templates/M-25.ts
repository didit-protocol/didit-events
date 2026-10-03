import { assetsOf, defineTemplate, type EmailBase, type EmailEvent } from "../common.ts";
import { fmtDayTimeZone, plural } from "../format.ts";
import type { EmailRow } from "../layout.ts";

/** What the hosts see of a requester. Profile fields and verified checks only: never the selfie or biometric data. */
export interface HostApplicant {
  name: string;
  email: string;
  /** `cid:applicant-1`: the profile photo as an inline attachment (guest photos are never public); absent = initials. */
  photoUrl?: string | null;
  headline: string;
  company: string;
  jobRole: string;
  links: { kind: "linkedin" | "website" | "other"; label: string; href: string }[];
  /** Contact phone from the request form, if asked. */
  phone?: string | null;
}

export interface HostRequestCounts {
  pending: number;
  waitlisted: number;
  capacity: number;
  /** Capacity minus approved places, never below zero. */
  capacityLeft: number;
}

export interface M25Data extends EmailBase {
  event: EmailEvent;
  /** "request" = pending review; "waitlist" = the event was full, so the request joined the waitlist. */
  kind: "request" | "waitlist";
  applicant: HostApplicant;
  /** Extra checks Didit verified for this request (labels: "Phone", "ID document", "Age"). */
  verifiedChecks: string[];
  answers: { question: string; answer: string }[];
  requestedAt: Date;
  counts: HostRequestCounts;
  reviewUrl: string;
  allRequestsUrl: string;
}

export const initialsOf = (name: string) =>
  name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map((w) => [...w][0]!.toUpperCase()).join("") || "?";

export const countRows = (c: HostRequestCounts): EmailRow[] => [
  { k: "Pending", v: plural(c.pending, "request") },
  ...(c.waitlisted ? [{ k: "Waitlist", v: `${c.waitlisted} ${c.waitlisted === 1 ? "person" : "people"}` }] : []),
  { k: "Places left", v: `${c.capacityLeft} of ${c.capacity}` },
];

/** Internal note to the event's hosts when a guest requests a place or joins the waitlist (lane H, v4). */
export const M25 = defineTemplate<M25Data>({ code: "M-25", name: "New request · hosts", trigger: "guest request or waitlist entry (hosts and event creator)" }, (d) => {
  const a = d.applicant, waitlist = d.kind === "waitlist";
  const work = [a.jobRole, a.company].filter(Boolean).join(", ");
  const link = (kind: "linkedin" | "website") => a.links.find((l) => l.kind === kind)?.href;
  const rows: EmailRow[] = [
    { k: "Email", v: a.email },
    ...(a.company ? [{ k: "Company", v: a.company }] : []),
    ...(a.jobRole ? [{ k: "Role", v: a.jobRole }] : []),
    ...(link("linkedin") ? [{ k: "LinkedIn", v: link("linkedin")! }] : []),
    ...(link("website") ? [{ k: "Website", v: link("website")! }] : []),
    ...(a.phone ? [{ k: "Phone", v: a.phone }] : []),
    { k: "Verified", v: ["Email", "Human check", ...d.verifiedChecks].join(", "), tone: "success" as const },
    { k: "Requested", v: fmtDayTimeZone(d.requestedAt, d.event.timeZone) },
  ];
  return {
    variant: "account",
    assetsUrl: assetsOf(d),
    subject: waitlist ? `New request: ${a.name} for ${d.event.name} (waitlist)` : `New request: ${a.name} for ${d.event.name}`,
    preheader: waitlist ? `${a.name} joined the waitlist. Review the profile and decide.` : `${a.name} asked for a place. Review the profile and accept or decline.`,
    eyebrow: waitlist ? "HOSTS · JOINED THE WAITLIST" : "HOSTS · NEW REQUEST",
    headline: waitlist ? `${a.name} joined the waitlist` : `${a.name} wants to join`,
    body: waitlist
      ? `${d.event.name} is full, so ${a.name}'s request is on the waitlist. You can still review it and accept if a place opens.`
      : `${a.name} requested a place at ${d.event.name}. Review the profile and accept or decline.`,
    blocks: [
      { kind: "person", name: a.name, initials: initialsOf(a.name), photoUrl: a.photoUrl ?? null, mark: "Verified by Didit", lines: [a.headline, work].filter(Boolean) },
      { kind: "rows", labelWidth: 100, size: "sm", rows },
      ...(d.answers.length ? [{ kind: "qa" as const, title: "ANSWERS", items: d.answers.map((x) => ({ q: x.question, a: x.answer })) }] : []),
      { kind: "rows", labelWidth: 100, size: "sm", rows: countRows(d.counts) },
      { kind: "buttons", primary: { label: "Review request", href: d.reviewUrl }, secondary: { label: "All requests", href: d.allRequestsUrl } },
    ],
    footer: { legal: "You host or created this event on Didit Events, so you get its new requests.", link: { label: "All requests", href: d.allRequestsUrl } },
  };
});
