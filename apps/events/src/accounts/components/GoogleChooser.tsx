import { assetSrc } from "@didit-events/ui";
import google from "@didit-events/ui/assets/google.svg";
import type { PublicEvent } from "../../public/types";
import { EventChip, GuestScreen, Lead, Title } from "./Screen";
import g from "./GoogleChooser.module.css";

/** 05 U-02: Google's own account chooser, drawn for flow context only (Google hosts it; Didit sign-in opens it). */
export function GoogleChooser({ event, accounts }: { event: PublicEvent; accounts: { name: string; email: string; initials: string }[] }) {
  return (
    <GuestScreen header="events" labelledBy="g-title">
      <EventChip event={event} />
      <Title id="g-title" size={22}>
        Continue with Google
      </Title>
      <Lead>Google opens in a popup (desktop) or redirect (mobile).</Lead>
      <div className={g.popup}>
        <div className={g.bar}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6E6E73" strokeWidth="2" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          accounts.google.com
        </div>
        <div className={g.body}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetSrc(google as string | { src: string })} alt="Google" width={22} height={22} />
          <span className={g.h}>Choose an account</span>
          <span className={g.sub}>to continue to Didit Events</span>
          {accounts.map((a) => (
            <div key={a.email} className={g.acct}>
              <span className={g.av}>{a.initials}</span>
              <span className={g.who}>
                <span className={g.n}>{a.name}</span>
                <span className={g.e}>{a.email}</span>
              </span>
            </div>
          ))}
          <span className={g.legal}>Google will share your name, email and profile picture with Didit Events.</span>
        </div>
      </div>
    </GuestScreen>
  );
}
