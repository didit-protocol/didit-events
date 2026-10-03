import { assetsOf, defineTemplate, type EmailBase, type EmailEvent } from "../common.ts";
import { fmtTime, fmtDayTimeZone, plural } from "../format.ts";
import { countRows, initialsOf, type HostRequestCounts } from "./M-25.ts";

export interface M26Data extends EmailBase {
  event: EmailEvent;
  /** The requests this digest groups, oldest first. */
  /** `photoUrl`: `cid:applicant-<n>` inline photo (the first 10 at most); absent = initials. */
  requests: { name: string; headline: string; company: string; kind: "request" | "waitlist"; requestedAt: Date; photoUrl?: string | null }[];
  windowStart: Date;
  counts: HostRequestCounts;
  allRequestsUrl: string;
}

/** Shown in full; the rest are counted ("and 4 more"). */
export const DIGEST_LISTED = 25;

/** Batch guard for M-25: past 10 host emails in 10 minutes for one event, the next requests arrive as one digest. */
export const M26 = defineTemplate<M26Data>({ code: "M-26", name: "New requests digest · hosts", trigger: "more than 10 requests in 10 minutes for one event" }, (d) => {
  const tz = d.event.timeZone, n = d.requests.length, shown = d.requests.slice(0, DIGEST_LISTED);
  return {
    variant: "account",
    assetsUrl: assetsOf(d),
    subject: `${plural(n, "new request")} for ${d.event.name}`,
    preheader: `Requests are arriving quickly, so we grouped them into one email.`,
    eyebrow: "HOSTS · NEW REQUESTS",
    headline: `${plural(n, "new request")}`,
    body: `${n === 1 ? "One more person" : `${n} more people`} asked to join ${d.event.name} since ${fmtDayTimeZone(d.windowStart, tz)}. Requests are arriving quickly, so we grouped them into one email.`,
    blocks: [
      {
        kind: "people",
        items: shown.map((r) => ({ k: fmtTime(r.requestedAt, tz), name: r.name, initials: initialsOf(r.name), photoUrl: r.photoUrl ?? null,
          line: [[r.headline, r.company].filter(Boolean).join(", "), r.kind === "waitlist" ? "waitlist" : ""].filter(Boolean).join(" · ") })),
        ...(n > shown.length ? { more: `and ${n - shown.length} more` } : {}),
      },
      { kind: "rows", labelWidth: 100, size: "sm", rows: countRows(d.counts) },
      { kind: "buttons", primary: { label: "Review requests", href: d.allRequestsUrl } },
    ],
    footer: { legal: "You host or created this event on Didit Events, so you get its new requests.", link: { label: "All requests", href: d.allRequestsUrl } },
  };
});
