import { Logo } from "@didit-events/ui";
import { dayMonth, shortDate, time } from "../../public/format";
import { coverAt, coverSrc } from "../../public/photos";
import type { PublicEvent } from "../../public/types";
import s from "./FaceTicket.module.css";

/**
 * The "face ticket" (04 R-19): the event, the verified guest, and WHEN / WHERE / TICKET / GUEST. Under the name: what
 * the face check proved ("Human verified by Didit"), and "ID verified" only when an ID document proved the name
 * (`idVerified` = the profile's name_from_id rule), so the ticket never says more than the profile does.
 */
export function FaceTicket({ event, guestName, verifiedAt, idVerified = false }: { event: PublicEvent; guestName: string; verifiedAt: string; idVerified?: boolean }) {
  // A banner-format cover fits this strip as designed (it carries its own logos); the square cover is a cropped fallback.
  // The 150px strip is at most 496px wide: a width-limited cover (1080 for the banner, 720 for the square), never the upload.
  const wide = event.cover.wideSrc ? coverAt(event.cover.wideSrc, 1080) : undefined;
  const bg = wide
    ? `linear-gradient(0deg, rgba(254,254,254,.85), rgba(254,254,254,0) 55%), url(${wide})`
    : `linear-gradient(160deg, rgba(254,254,254,.6), rgba(254,254,254,0) 70%), url(${coverSrc(event.cover, 720)})`;
  return (
    <section className={s.ticket} aria-label="Your face ticket">
      <div className={s.head} style={{ backgroundImage: bg, ...(wide ? { backgroundPosition: "center top" } : {}) }}>
        {wide ? <span aria-hidden="true" /> : <Logo variant="color" height={16} alt="Didit" />}
        <p className={s.name}>
          {event.title}
          {event.accent ? (
            <>
              {" "}
              <span className={s.accent}>{event.accent}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className={s.foot}>
        <div className={s.who}>
          <span className={s.check} aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FEFEFE" strokeWidth="2.4" strokeLinecap="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <span className={s.whoText}>
            <span className={s.guest}>{guestName}</span>
            <span className={s.verified}>{`Human verified by Didit · ${dayMonth(verifiedAt, event.timeZone)}`}</span>
            {idVerified ? <span className={s.verified}>ID verified</span> : null}
          </span>
        </div>
        <dl className={s.grid}>
          <div className={s.cell}>
            <dt className={s.k}>WHEN</dt>
            <dd className={s.v}>{`${shortDate(event.startsAt, event.timeZone)} · ${time(event.startsAt, event.timeZone)}`}</dd>
          </div>
          <div className={s.cell}>
            <dt className={s.k}>WHERE</dt>
            <dd className={s.v}>{event.venue.name}</dd>
          </div>
          <div className={s.cell}>
            <dt className={s.k}>TICKET</dt>
            <dd className={s.v}>Your face</dd>
          </div>
          <div className={s.cell}>
            <dt className={s.k}>GUEST</dt>
            <dd className={s.v}>Just you</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
