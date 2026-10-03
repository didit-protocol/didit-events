
import { CsrfField } from "../../auth/CsrfField";
import type { ReactNode } from "react";
import { ButtonLink, StatusIcon, SubmitButton, cx, type StatusIconName, type StatusTone } from "@didit-events/ui";
import { shortDate, time } from "../format";
import type { PublicEvent, Viewer } from "../types";
import { SiteHeader } from "./SiteHeader";
import layout from "./GuestLayout.module.css";
import s from "./MessageScreen.module.css";

export type MessageCta =
  | { label: string; href: string; secondary?: boolean }
  | { label: string; action: (form: FormData) => Promise<void>; fields: Record<string, string>; pendingLabel: string; secondary?: boolean };

export interface MessageScreenProps {
  /** Shows the event chip above the message (all but "not found"). */
  event?: PublicEvent;
  tone: StatusTone;
  /** Defaults to the tone's mark. */
  icon?: StatusIconName;
  /** 88 = the solid hero check (G-03 approved). */
  iconSize?: 64 | 88;
  title: string;
  body: ReactNode;
  cta?: MessageCta;
  /** Extra row under the body (G-03 calendar buttons). */
  extra?: ReactNode;
  foot?: ReactNode;
  /** Heading level: h1 on a page. */
  as?: "h1" | "h2";
  /** The signed-in guest: the screen then keeps the site header (nav and avatar menu) of the pages around it. */
  viewer?: Viewer | null;
  /** A dead end with one way on: the button follows the message instead of sitting at the bottom of a phone screen. */
  inlineCta?: boolean;
}

/** The 390 guest message screen (G-01f–i, G-02b–e, G-03a–d): event chip, round status icon, title, body, one button. */
export function MessageScreen({ event, tone, icon, iconSize = 64, title, body, cta, extra, foot, as: Heading = "h1", viewer, inlineCta }: MessageScreenProps) {
  return (
    <div className={layout.root}>
      <div className={cx(s.page, layout.canvas)}>
        <SiteHeader viewer={viewer} signIn={false} />
        <main className={cx(s.body, layout.card)}>
          {event ? (
            <div className={s.chip}>
              <span className={s.chipName}>{event.title}</span>
              <span className={s.chipMeta}>{`${shortDate(event.startsAt, event.timeZone)} · ${time(event.startsAt, event.timeZone)} · ${event.venue.name}`}</span>
            </div>
          ) : null}
          <div className={cx(s.center, inlineCta && s.centerInline)} role="status">
            <StatusIcon tone={tone} icon={icon} size={iconSize} />
            <Heading className={s.title}>{title}</Heading>
            <p className={s.text}>{body}</p>
            {extra}
          </div>
          {cta ? (
            "href" in cta ? (
              <ButtonLink href={cta.href} variant={cta.secondary ? "secondary" : "primary"} size="xl" block>
                {cta.label}
              </ButtonLink>
            ) : (
              <form action={cta.action} className={s.ctaForm}><CsrfField />
                {Object.entries(cta.fields).map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
                <SubmitButton variant={cta.secondary ? "secondary" : "primary"} size="xl" block pendingLabel={cta.pendingLabel}>
                  {cta.label}
                </SubmitButton>
              </form>
            )
          ) : null}
          {foot ? <p className={s.foot}>{foot}</p> : null}
        </main>
      </div>
    </div>
  );
}
