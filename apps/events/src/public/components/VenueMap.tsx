import { Icon } from "@didit-events/ui";
import { mapEmbedSrc, mapsOpenHref } from "../map";
import type { Venue } from "../types";
import { VenueMapFrame } from "./VenueMapFrame";
import s from "./VenueMap.module.css";

/**
 * The Location map: the standard interactive Google Maps embed pinned on the exact picked place (zoom, drag, Google's
 * own "View larger map" card), as Alberto asked on 2026-10-02 ("typical embed of Google Maps"). Without a place the
 * box is a plain "Open in Google Maps" link. Until the lazy embed paints (or if it is blocked) the box shows the
 * venue's name under a pin instead of an empty grey panel; the embed covers it, so it stays the only control.
 * The embed itself is a client leaf (VenueMapFrame): it mounts only in the layout that is displayed.
 */
export function VenueMap({ venue, size = "desktop" }: { venue: Venue; size?: "desktop" | "mobile" }) {
  const src = mapEmbedSrc(venue);
  const href = mapsOpenHref(venue);
  const label = venue.name || venue.address;
  return (
    <div className={size === "mobile" ? s.mapMobile : s.map} data-venue-map="">
      {src ? (
        <span className={s.placeholder} aria-hidden="true">
          <Icon name="pin" size={20} />
          {label}
        </span>
      ) : null}
      {src ? (
        <VenueMapFrame className={s.frame} sentinelClassName={s.sentinel} title={`Map of ${label}`} src={src} />
      ) : (
        <a className={s.open} href={href} target="_blank" rel="noopener noreferrer" data-maps-control="">
          {`Open ${label} in Google Maps`}
        </a>
      )}
    </div>
  );
}
