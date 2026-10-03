/**
 * The event page map (P-01 Location). The embed pins the exact place picked in the editor (lat/lng from 0019's
 * Places field); only an event without coordinates falls back to a search for its venue and address. The embed is
 * a static preview: the page offers exactly one control to leave for Google Maps (`mapsOpenHref`).
 */
import type { Venue } from "./types";

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Exact coordinates, rounded to ~1 m (6 decimals) so the URL is stable. */
export function venueCoords(v: Pick<Venue, "lat" | "lng">): { lat: number; lng: number } | null {
  if (!finite(v.lat) || !finite(v.lng) || Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) return null;
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return { lat: r(v.lat), lng: r(v.lng) };
}

const searchText = (v: Pick<Venue, "name" | "address">) => [v.name, v.address].map((x) => x?.trim()).filter(Boolean).join(", ");

/** The keyless Google Maps embed: a pin on the coordinates, else a search for "venue, address". Null = no place. */
export function mapEmbedSrc(v: Pick<Venue, "name" | "address" | "lat" | "lng">): string | null {
  const c = venueCoords(v);
  // `loc:` always drops a pin on the exact point; without coordinates, the street address alone pins reliably.
  const q = c ? `loc:${c.lat},${c.lng}` : (v.address?.trim() || searchText(v));
  if (!q) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=16&hl=en&output=embed`;
}

/** A saved Maps link is followed only to Google Maps: maps.google.com, www.google.com/maps, goo.gl/maps, maps.app.goo.gl. */
export function isGoogleMapsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  const under = (prefix: string) => u.pathname === prefix || u.pathname.startsWith(`${prefix}/`);
  if (host === "maps.google.com" || host === "maps.app.goo.gl") return true;
  if (host === "www.google.com") return under("/maps");
  if (host === "goo.gl") return under("/maps");
  return false;
}

/**
 * The one "Open in Google Maps" destination: the picked place by ID (Google's documented Maps URL, which opens
 * exactly that place), else the saved Maps URL when it is https on a Google Maps host, else a search for the venue.
 */
export function mapsOpenHref(v: Pick<Venue, "name" | "address" | "mapsUrl" | "placeId" | "lat" | "lng">): string {
  const placeId = v.placeId?.trim();
  if (placeId) {
    const c = venueCoords(v);
    const query = c ? `${c.lat},${c.lng}` : searchText(v) || placeId;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&query_place_id=${encodeURIComponent(placeId)}`;
  }
  if (v.mapsUrl && isGoogleMapsUrl(v.mapsUrl)) return v.mapsUrl;
  const c = venueCoords(v);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c ? `${c.lat},${c.lng}` : searchText(v))}`;
}
