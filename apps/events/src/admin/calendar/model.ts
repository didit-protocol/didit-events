import type { CalendarProfileRow } from "@didit-events/core/calendar";
import { BUILT_IN_COPY, calendarImageSrc, calendarProfile } from "../../public/calendar-profile";
import { fmtWhen } from "../person/format";
import { PEOPLE_TZ } from "../people/query";
import type { CalendarFormValues } from "./validate";

export interface CalendarAdminModel {
  values: CalendarFormValues;
  /** A stored row exists (the preview applies the same tagline rule as the public header). */
  hasRow: boolean;
  coverUrl?: string;
  logoUrl?: string;
  /** The built-in banner the preview falls back to. */
  defaultCoverUrl: string;
  updatedAt: string | null;
  /** "30 Sep 2026, 22:12" in the admin time zone, formatted on the server: the client form prints it as is, so the
   *  server render and hydration never disagree over ICU data ("Sep" vs "Sept"). */
  updatedAtLabel: string | null;
  updatedBy: string | null;
}

/** The form's starting point: the stored row, or the built-in header copy (pure; the page guards and reads). */
export function calendarAdminModel(row: CalendarProfileRow | null): CalendarAdminModel {
  return {
    values: {
      name: row?.name ?? BUILT_IN_COPY.name,
      tagline: row?.tagline ?? BUILT_IN_COPY.tagline,
      description: row?.description ?? BUILT_IN_COPY.description,
      websiteUrl: row?.websiteUrl ?? "",
      xUrl: row?.xUrl ?? "",
      linkedinUrl: row?.linkedinUrl ?? "",
    },
    hasRow: Boolean(row),
    coverUrl: row?.coverType ? calendarImageSrc("cover", row.coverVersion) : undefined,
    logoUrl: row?.logoType ? calendarImageSrc("logo", row.logoVersion) : undefined,
    defaultCoverUrl: calendarProfile(null).coverUrl!,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedAtLabel: row ? fmtWhen(row.updatedAt.toISOString(), PEOPLE_TZ, true) : null,
    updatedBy: row?.updatedBy ?? null,
  };
}
