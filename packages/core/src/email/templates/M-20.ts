import { assetsOf, defineTemplate, privacyLink, siteHost, type EmailBase, type EmailEvent } from "../common.ts";
import { fmtDay, fmtDayTime } from "../format.ts";

export interface M20Data extends EmailBase {
  event: EmailEvent;
  /** "cancelled" = an admitted guest gave up a place (U-26/U-30); "withdrawn" = a pending request was withdrawn. */
  kind: "cancelled" | "withdrawn";
  reason?: string;
  cancelledAt: Date;
  requestAgainUrl: string;
}

export const M20 = defineTemplate<M20Data>({ code: "M-20", name: "Cancellation confirmed", trigger: "U-26 / U-30" }, (d) => {
  const tz = d.event.timeZone;
  const day = fmtDay(d.event.startsAt, tz);
  const withdrawn = d.kind === "withdrawn";
  return {
    variant: "account",
    assetsUrl: assetsOf(d),
    subject: withdrawn ? `You withdrew your request for ${d.event.shortName}` : `You cancelled your place for ${d.event.shortName}`,
    preheader: withdrawn ? "Your request is withdrawn." : "Your place has been released.",
    eyebrow: withdrawn ? "WITHDRAWN" : "CANCELLED",
    headline: "Thanks for letting us know",
    body: withdrawn
      ? `Your request for ${day} is withdrawn. Changed your mind? Request again while places last.`
      : `Your place for ${day} has been released. Changed your mind? Request again while places last.`,
    blocks: [
      { kind: "buttons", primary: { label: "Request again", href: d.requestAgainUrl } },
      {
        kind: "rows",
        labelWidth: 100,
        size: "sm",
        rows: [...(d.reason ? [{ k: "Reason", v: d.reason }] : []), { k: withdrawn ? "Withdrawn" : "Cancelled", v: fmtDayTime(d.cancelledAt, tz) }],
      },
    ],
    footer: { legal: `You cancelled on ${siteHost(d)}.`, link: privacyLink(d) },
  };
});
