import type { PublicEvent } from "../../public/types";
import type { GuestAccount, RequirementRow } from "../types";
import { ActionButton, Callout, EventChip, Eyebrow, GuestScreen, MetGlyph, RowGroup, SecuredByDidit, Spacer } from "./Screen";
import { initialsOf } from "./StatusScreen";
import { displayName } from "../../public/viewer-name";

/**
 * "This event requires" (05 U-39 / U-40): what the event needs against the guest's verified Didit profile. All met →
 * approval lands on "You are in" with no new verification (U-41); one missing → only that step after approval.
 */
export function RequirementsScreen({ event, account, rows, request }: { event: PublicEvent; account: GuestAccount; rows: RequirementRow[]; request: (form: FormData) => Promise<void> }) {
  const missing = rows.filter((r) => !r.met);
  return (
    <GuestScreen header="account" initials={initialsOf(account)} accountName={displayName(account)} sheet={{ event, variant: "flow" }} labelledBy="req-title">
      <EventChip event={event} />
      <Eyebrow as="h1" id="req-title">
        THIS EVENT REQUIRES
      </Eyebrow>
      <Callout tone={missing.length ? "info" : "success"} live={false}>
        {missing.length
          ? missing.length === 1 && missing[0]!.kind === "age"
            ? "After approval you only confirm your age (about 1 minute). Everything else is reused."
            : `After approval you only complete ${missing.map((m) => m.label.toLowerCase()).join(" and ")}. Everything else is reused.`
          : "You already meet every requirement. If approved, you are in straight away: no new verification."}
      </Callout>
      <RowGroup title="YOUR VERIFIED PROFILE" rows={rows.map((r) => ({ key: r.kind, label: r.label, detail: r.detail, action: <MetGlyph met={r.met} /> }))} />
      <Spacer />
      <ActionButton action={request} fields={{ slug: event.slug }} pendingLabel="Sending request…">
        {missing.length ? "Request to join" : "Request with verified profile"}
      </ActionButton>
      <SecuredByDidit />
    </GuestScreen>
  );
}
