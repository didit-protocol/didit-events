import type { ReactNode } from "react";
import { Icon, Logo } from "@didit-events/ui";
import { coverPhoto } from "../photos";
import type { CalendarProfile } from "../types";
import { SocialLink } from "./SocialIcons";
import s from "./CalendarPage.module.css";

/**
 * The P-03 header: cover banner with the square logo tile overlapping its bottom-left corner, then the host block
 * (name, optional tagline, bio, links: the website as text, X and LinkedIn as their logos). `aside` is the right-hand slot (Subscribe); `stats` sits under the bio.
 * The block reserves the tile's overhang itself, so nothing overlaps the logo in any container (the page column
 * or the /admin/calendar live preview, which renders the same component).
 */
export function CalendarHeader({ profile, stats, aside, headingLevel = 1 }: { profile: CalendarProfile; stats?: ReactNode; aside?: ReactNode; headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <header className={s.header}>
      <div className={s.banner} style={{ backgroundImage: `url(${profile.coverUrl ?? coverPhoto("aqua")})` }}>
        <span className={s.mark} data-custom={profile.logoUrl ? "" : undefined}>
          {profile.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.logoUrl} alt="" width={80} height={80} className={s.logoImg} />
          ) : (
            <Logo variant="mark" height={44} alt="" className={s.markImg} />
          )}
        </span>
      </div>
      <div className={s.host}>
        <div className={s.hostText}>
          {profile.showTagline && profile.tagline ? <span className={s.tagline}>{profile.tagline}</span> : null}
          <Heading className={s.name}>{profile.name}</Heading>
          {profile.description ? <p className={s.description}>{profile.description}</p> : null}
          {profile.links?.length ? (
            <ul className={s.links} aria-label="Links">
              {profile.links.map((l) => {
                const brand = l.kind === "x" || l.kind === "linkedin" ? l.kind : null;
                return (
                  <li key={l.kind}>
                    {brand ? (
                      <SocialLink kind={brand} href={l.href} className={s.brandLink} />
                    ) : (
                      <a href={l.href} target="_blank" rel="noopener noreferrer" className={s.link}>
                        {l.label}
                        <Icon name="external" size={12} />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {stats}
        </div>
        {aside}
      </div>
    </header>
  );
}
