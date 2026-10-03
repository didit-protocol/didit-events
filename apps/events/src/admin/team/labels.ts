/** Team labels shared with client components. Kept apart from policy.ts so zod stays out of the browser bundle. */
import type { StaffRole } from "./types";

export const ROLE_LABEL: Record<StaffRole, string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

/** Resend invite outcomes, shown next to the row's button. */
export const RESEND_COPY = {
  sent: "Invite sent again.",
  cooldown: "Invite just sent. Try again in a minute.",
  signed_in: "They have already signed in.",
  failed: "Couldn’t resend the invite. Reload the page and try again.",
} as const;
