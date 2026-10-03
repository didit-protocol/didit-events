import type { ReactNode } from "react";
import { HEADER_LOGO_HEIGHT, Logo, cx } from "@didit-events/ui";
import s from "./SiteHeader.module.css";

export interface SiteHeaderBarProps {
  /** Where the logo goes (default: the public calendar). */
  home?: string;
  homeLabel?: string;
  /** The right side: the avatar menu, Sign in, or nothing. */
  children?: ReactNode;
  className?: string;
}

/**
 * The one header bar of every page (public site, account pages, flow screens, admin on phones): the 24px Didit logo
 * on the left (with the EVENTS tag from 768px), one control on the right. It measures its own width, so the same
 * markup is the 56px phone bar below 768px and the 64px bar above, in the window and inside a narrower box alike.
 */
export function SiteHeaderBar({ home = "/events", homeLabel = "Didit Events, all events", children, className }: SiteHeaderBarProps) {
  return (
    <header className={cx(s.header, className)}>
      <div className={s.bar}>
        <a href={home} className={s.brand} aria-label={homeLabel}>
          <Logo variant="color" height={HEADER_LOGO_HEIGHT} alt="" />
          <span className={s.tag} aria-hidden="true">
            EVENTS
          </span>
        </a>
        {children}
      </div>
    </header>
  );
}
