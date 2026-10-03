import { Tag, type TagTone } from "@didit-events/ui";
import type { PersonVerificationState } from "../person/types";
import { VERIFICATION_LABEL } from "./query";
import type { PeopleRow } from "./types";

export const VERIFICATION_TONE: Record<PersonVerificationState, TagTone> = {
  verified: "success",
  expired: "warning",
  in_review: "feature",
  declined: "danger",
  in_progress: "neutral",
  not_started: "neutral",
};

/** The verification column: Didit's face check state, or Deleted / Deleting for accounts on their way out. */
export function VerificationTag({ row }: { row: Pick<PeopleRow, "verification" | "deletion"> }) {
  if (row.deletion) return <Tag tone="danger">{row.deletion === "deleted" ? "Deleted" : "Deleting"}</Tag>;
  return <Tag tone={VERIFICATION_TONE[row.verification]}>{VERIFICATION_LABEL[row.verification]}</Tag>;
}
