import type { ReactNode } from "react";
import { Avatar } from "@didit-events/ui";
import { safeHttpsUrl } from "../form/url";
import { LazyPersonBadge } from "./LazyBadge";
import type { PersonSummary } from "./types";
import s from "./Person.module.css";

/** The staff photo route (event applicant, or the owner People route), or an https photo; anything else falls back to initials. */
export function personPhoto(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^\/api\/admin\/events\/[a-f0-9-]{36}\/applicants\/[a-f0-9-]{36}\/photo(\?v=\d+)?$/.test(url)) return url;
  if (/^\/api\/admin\/people\/[a-f0-9-]{36}\/photo(\?v=\d+)?$/.test(url)) return url;
  return safeHttpsUrl(url) ?? undefined;
}

/** Table cell: photo (or initials), name, badge, and an optional second line. `unnamed` replaces the name (muted) for a person who has none yet. */
export function PersonCell({ name, email, summary, sub, href, unnamed }: { name: string; email: string; summary?: PersonSummary; sub?: ReactNode; href?: string; unnamed?: string }) {
  return (
    <span className={s.cell}>
      <Avatar name={name} email={email} src={personPhoto(summary?.photoUrl)} size={32} />
      <span className={s.cellText}>
        <span className={s.cellName}>
          {href ? <a href={href} data-unnamed={unnamed ? "" : undefined}>{unnamed ?? name}</a> : <b data-unnamed={unnamed ? "" : undefined}>{unnamed ?? name}</b>}
          <LazyPersonBadge verified={summary?.verified} timeZone={summary?.timeZone ?? "UTC"} size={15} />
        </span>
        {sub ? <span className={s.cellSub}>{sub}</span> : null}
      </span>
    </span>
  );
}

