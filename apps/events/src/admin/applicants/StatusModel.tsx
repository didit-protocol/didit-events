/** S-00 Status model (design/05): the five groups of `STATUS_MODEL` from `@didit-events/core/domain`. */
import { STATUS_MODEL, type DesignStatus } from "@didit-events/core/domain/status-model";
import { StatusPill, type EventPillStatus, type GuestPillStatus, type PillStatus } from "@didit-events/ui";
import m from "./StatusModel.module.css";

const GROUPS: { k: string; t: string; flow: string; rows: DesignStatus[] }[] = [
  { k: "ACCOUNT", t: "Guest account", flow: "Signed out → signed in (Google or email code) → profile complete", rows: ["signed_out", "signed_in", "profile_incomplete", "profile_verified", "deleted"] },
  { k: "REGISTRATION", t: "Request to join", flow: "Pending → approved | waitlist | rejected | withdrawn", rows: ["pending", "invited", "waitlist", "rejected", "withdrawn"] },
  { k: "VERIFICATION", t: "Didit identity check", flow: "Approved → link sent → verifying → verified | in review | declined", rows: ["link_sent", "verifying", "in_review", "declined", "verified", "reused", "re_verify"] },
  { k: "ATTENDANCE", t: "Going to the event", flow: "Going → checked in | no-show | cancelled | revoked", rows: ["going", "cancelled", "revoked", "checked_in", "no_show"] },
  { k: "EVENT", t: "Event lifecycle", flow: "Draft → open → full / closed → live → ended", rows: ["draft", "open", "full", "closed", "live", "ended"] },
];

type Tone = PillStatus | GuestPillStatus | EventPillStatus;
/** The design's pill colours (`Component.pill`) on the kit's pills; SIGNED OUT and DRAFT use the #9DA1A1 dot. */
const TONE: Record<DesignStatus, [Tone, boolean?]> = {
  signed_out: ["ended", true], signed_in: ["verified"], profile_incomplete: ["pending"], profile_verified: ["verified"], deleted: ["ended"],
  pending: ["pending"], invited: ["approved"], waitlist: ["pending"], rejected: ["rejected"], withdrawn: ["ended"],
  link_sent: ["link-sent"], verifying: ["verifying"], in_review: ["in-review"], declined: ["declined"], verified: ["verified"], reused: ["verified"], re_verify: ["pending"],
  going: ["verified"], cancelled: ["ended"], revoked: ["revoked"], checked_in: ["checked-in"], no_show: ["pending"],
  draft: ["ended", true], open: ["open"], full: ["full"], closed: ["closed"], live: ["live"], ended: ["ended"],
};

export function StatusModel() {
  return (
    <div className={m.model}>
      {GROUPS.map((g) => (
        <section key={g.k} className={m.group} aria-labelledby={`s00-${g.k}`}>
          <div className={m.title}>
            <span className={m.key}>{g.k}</span>
            <h2 id={`s00-${g.k}`}>{g.t}</h2>
            <span className={m.flow}>{g.flow}</span>
          </div>
          <div className={m.table} role="table" aria-label={g.t}>
            <div role="row" className={`${m.row} ${m.head}`}>
              {["STATUS", "SET BY", "GUEST SEES", "ADMIN SEES", "EMAIL", "CAN MOVE TO"].map((h) => (
                <span key={h} role="columnheader">
                  {h}
                </span>
              ))}
            </div>
            {g.rows.map((key) => {
              const r = STATUS_MODEL[key];
              const [tone, midDot] = TONE[key];
              return (
                <div key={key} role="row" className={m.row}>
                  <span role="cell">
                    <StatusPill status={tone} className={midDot ? m.midDot : undefined}>
                      {r.label}
                    </StatusPill>
                  </span>
                  <span role="cell" className={m.dim}>
                    {r.setBy}
                  </span>
                  <span role="cell">{r.guest}</span>
                  <span role="cell" className={m.dim}>
                    {r.admin}
                  </span>
                  <span role="cell" className={m.mail}>
                    {r.email}
                  </span>
                  <span role="cell" className={m.dim}>
                    {r.canMoveTo}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
