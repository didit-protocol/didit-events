/**
 * P-03 header copy and assets. The stored `calendar_profiles` row (edited in /admin/calendar) wins field by field;
 * with no row the page renders the built-in Didit header exactly as before.
 */
import type { CalendarProfileRow } from "@didit-events/core/calendar";
import { count } from "./format";
import { coverPhoto } from "./photos";
import type { CalendarLink, CalendarProfile } from "./types";

export const DEFAULT_CALENDAR_PROFILE = {
  name: "Didit Events",
  tagline: "Identity, fraud and founders",
  description: "Evenings for founders, operators and fraud teams in Barcelona, San Francisco and beyond. Every door runs on Didit face check-in.",
} as const;

/** The stats line under the bio (public page and the /admin/calendar preview). */
export const calendarStats = (subscribers: number, events: number) => `${count(subscribers)} subscribers · ${events} events`;

export const calendarImageSrc = (kind: "cover" | "logo", version: number) => `/api/calendar/${kind}?v=${version}`;

/** Website / X / LinkedIn, in that order, only the ones that are set. */
export function calendarLinks(row: Pick<CalendarProfileRow, "websiteUrl" | "xUrl" | "linkedinUrl">): CalendarLink[] {
  const links: CalendarLink[] = [];
  if (row.websiteUrl) links.push({ kind: "website", label: new URL(row.websiteUrl).host.replace(/^www\./, ""), href: row.websiteUrl });
  if (row.xUrl) links.push({ kind: "x", label: "X", href: row.xUrl });
  if (row.linkedinUrl) links.push({ kind: "linkedin", label: "LinkedIn", href: row.linkedinUrl });
  return links;
}

/**
 * The one tagline rule for the public header and the /admin/calendar preview: a stored row shows its tagline when it
 * has one; with no row the built-in header hides it.
 */
export const showTagline = (hasRow: boolean, tagline: string) => hasRow && Boolean(tagline.trim());

/**
 * The copy the built-in header actually shows (its tagline hidden). Seeds the editor and a row created by an image
 * upload, so neither makes a tagline appear that the public page did not show.
 */
export const BUILT_IN_COPY = { name: DEFAULT_CALENDAR_PROFILE.name, tagline: "", description: DEFAULT_CALENDAR_PROFILE.description };

/** The header view model for a stored row (or the built-in header for null). */
export function calendarProfile(row: CalendarProfileRow | null): CalendarProfile {
  if (!row) return { ...DEFAULT_CALENDAR_PROFILE, showTagline: showTagline(false, DEFAULT_CALENDAR_PROFILE.tagline), coverUrl: coverPhoto("aqua"), links: [] };
  return {
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    showTagline: showTagline(true, row.tagline),
    coverUrl: row.coverType ? calendarImageSrc("cover", row.coverVersion) : coverPhoto("aqua"),
    logoUrl: row.logoType ? calendarImageSrc("logo", row.logoVersion) : undefined,
    links: calendarLinks(row),
  };
}
