import { VerifiedBadge } from "@didit-events/ui";
import { verifiedLines } from "./format";
import type { PersonSummary } from "./types";

/** Blue seal next to a name, with the "Verified by Didit" tooltip. */
export function PersonBadge({ verified, timeZone, size = 16 }: { verified: PersonSummary["verified"]; timeZone: string; size?: 14 | 15 | 16 }) {
  if (!verified) return null;
  const { label, details } = verifiedLines(verified, timeZone);
  return <VerifiedBadge label={label} details={details} size={size} />;
}
