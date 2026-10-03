import { Avatar, cx } from "@didit-events/ui";
import { safeHttpsUrl } from "../form/url";
import p from "../person/Person.module.css";
import { FaceAvatar } from "./FaceAvatar";
import type { LogRowView } from "./helpers";
import { LogPersonBadge } from "./LogTable";
import s from "./Log.module.css";

/**
 * `personPhoto` of person/PersonCell, restated here: importing that module would pull its client LazyPersonBadge (and
 * the next/dynamic runtime) into this route's first-load JS.
 */
function photo(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^\/api\/admin\/events\/[a-f0-9-]{36}\/applicants\/[a-f0-9-]{36}\/photo(\?v=\d+)?$/.test(url)) return url;
  if (/^\/api\/admin\/people\/[a-f0-9-]{36}\/photo(\?v=\d+)?$/.test(url)) return url;
  return safeHttpsUrl(url) ?? undefined;
}

/**
 * The GUEST cell, rendered on the server (the client table only wraps it): photo or initials, name and the blue
 * badge as in the Guests table, or the neutral face for a scan that matched nobody. The name links to the row's
 * drawer, so a keyboard user opens it with Enter.
 */
export function LogGuestCell({ row }: { row: LogRowView }) {
  if (row.anonymous) {
    return (
      <span className={s.anon}>
        {row.faceOnly ? <FaceAvatar /> : null}
        <a href={row.href} className={cx(s.guest, s.none)}>
          {row.guest}
        </a>
      </span>
    );
  }
  return (
    <span className={p.cell}>
      <Avatar name={row.guest} email={row.email} src={photo(row.person?.photoUrl)} size={32} />
      <span className={p.cellText}>
        <span className={p.cellName}>
          <a href={row.href}>{row.guest}</a>
          <LogPersonBadge verified={row.person?.verified} timeZone={row.person?.timeZone ?? "UTC"} size={15} />
        </span>
      </span>
    </span>
  );
}
