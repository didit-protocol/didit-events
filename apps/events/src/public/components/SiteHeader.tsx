import Link from "next/link";
import { ButtonLink } from "@didit-events/ui";
import { links } from "../links";
import type { Viewer } from "../types";
import { AccountMenu } from "./AccountMenuLazy";
import { SiteHeaderBar } from "./SiteHeaderBar";
import s from "./SiteHeader.module.css";

const viewerName = (v: Viewer) => `${v.firstName} ${v.lastName}`.trim();

export interface SiteHeaderProps {
  viewer?: Viewer | null;
  /** The event-time clock ("18:02 CEST", P-01). */
  clock?: string;
  /** Where "Sign in" returns to. */
  next?: string;
  /** A signed-in Didit staff member (admin session): shown so it is clear who is signed in. */
  staff?: { email: string } | null;
  /** Signed out: show the Sign in pill (default). Off on the screens that are a sign-in or a personal link themselves. */
  signIn?: boolean;
  className?: string;
}

/**
 * The public header (P-01 / P-03, account pages, flow screens). Signed in: the avatar menu; signed out: Sign in.
 * From 768px it also shows the event clock, the staff chip and the Explore events / My events links; on phones those
 * two destinations live in the avatar menu, so the bar is only the logo and the avatar.
 */
export function SiteHeader({ viewer, clock, next, staff, signIn = true, className }: SiteHeaderProps) {
  const account = viewer ? (
    <AccountMenu name={viewerName(viewer)} email={viewer.email} photoUrl={viewer.photoUrl} staffRole={viewer.staffRole} />
  ) : signIn ? (
    <ButtonLink href={links.signIn(next)} variant="secondary" size="sm" className={s.signIn}>
      Sign in
    </ButtonLink>
  ) : null;
  return (
    <SiteHeaderBar className={className}>
      {account || clock || staff ? (
        <nav className={s.nav} aria-label="Account">
          {clock ? (
            <span className={s.clock} aria-label={`Local time at the event: ${clock}`}>
              {clock}
            </span>
          ) : null}
          {staff ? (
            <Link href="/admin" className={s.staff} title={`Signed in to admin as ${staff.email}`}>
              <span className={s.staffDot} aria-hidden="true" />
              Admin · {staff.email.split("@")[0]}
            </Link>
          ) : null}
          {viewer ? (
            <>
              <a href={links.calendar()} className={s.link}>
                Explore events
              </a>
              <a href={links.myEvents()} className={s.link}>
                My events
              </a>
            </>
          ) : null}
          {account}
        </nav>
      ) : null}
    </SiteHeaderBar>
  );
}
