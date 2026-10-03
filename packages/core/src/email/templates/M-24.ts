import { assetsOf, defineTemplate, type EmailBase, type EmailEvent } from "../common.ts";
import { fmtDayTime } from "../format.ts";

export interface M24Data extends EmailBase {
  event: EmailEvent;
  guest: { name: string; email: string };
  checkedInAt: Date;
  /** Where the check-in happened: "Kiosk · Main door". */
  checkedInBy: string;
  undoneAt: Date;
  undoneBy: { name: string; role: string };
  reason?: string;
  checkInLogUrl: string;
}

/** design-prompt v2: internal note to the event owner when staff undo a check-in. A plain table: who, when, by whom. */
export const M24 = defineTemplate<M24Data>({ code: "M-24", name: "Check-in undone", trigger: "staff undoes a check-in (owner only)" }, (d) => {
  const tz = d.event.timeZone;
  return {
    variant: "account",
    assetsUrl: assetsOf(d),
    subject: `Check-in undone: ${d.guest.name} · ${d.event.shortName}`,
    preheader: `${d.undoneBy.name} undid a check-in at ${fmtDayTime(d.undoneAt, tz)}.`,
    eyebrow: "INTERNAL · CHECK-IN UNDONE",
    headline: "A check-in was undone",
    body: `${d.undoneBy.name} undid the check-in of ${d.guest.name} for ${d.event.name}. The guest is back on the missing list.`,
    blocks: [
      {
        kind: "rows",
        labelWidth: 100,
        size: "sm",
        rows: [
          { k: "Guest", v: `${d.guest.name} · ${d.guest.email}` },
          { k: "Checked in", v: `${fmtDayTime(d.checkedInAt, tz)} · ${d.checkedInBy}` },
          { k: "Undone", v: fmtDayTime(d.undoneAt, tz) },
          { k: "By", v: `${d.undoneBy.name} (${d.undoneBy.role})` },
          ...(d.reason ? [{ k: "Reason", v: d.reason }] : []),
        ],
      },
      { kind: "buttons", primary: { label: "Open check-in log", href: d.checkInLogUrl } },
    ],
    footer: { legal: "You own this event on Didit Events. Only event owners get this email.", link: { label: "Team settings", href: `${d.baseUrl.replace(/\/$/, "")}/admin/team` } },
  };
});
