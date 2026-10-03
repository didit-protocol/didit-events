/** A-14 manual check-in eligibility: only an admitted guest (approved … verified) may be checked in by staff. */
import type { GuestStatus } from "./types";

export const CHECKIN_ELIGIBLE: readonly GuestStatus[] = ["approved", "link-sent", "verifying", "verified"];

/** Unknown, revoked, declined, rejected, cancelled, in review or already checked in: no manual check-in. */
export const canCheckIn = (status: unknown): boolean => typeof status === "string" && (CHECKIN_ELIGIBLE as readonly string[]).includes(status);

/** The drawer dialog a URL may open: `?checkin=1` is dropped for a guest who can't be checked in. */
export function allowedDialog<D extends string>(dialog: D | undefined, status: GuestStatus): D | undefined {
  return dialog === "checkin" && !canCheckIn(status) ? undefined : dialog;
}

/** Statuses a link email may be sent or resent for (row menu, drawer, bulk bar); `transitions.ts` enforces it. */
export const LINK_SENDABLE: readonly GuestStatus[] = ["approved", "link-sent", "verifying"];
export const canSendLink = (status: GuestStatus): boolean => LINK_SENDABLE.includes(status);
