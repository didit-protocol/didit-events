"use client";

import { accountLinks } from "../links";
import { KeepAccountPanel, type KeepAction } from "./KeepAccount";
import { CtaLink, GuestScreen } from "./Screen";

/** /me/deleting: the account is in its deletion grace period; "Keep my account" returns to where the guest was going. */
export function DeletingScreen({ graceUntil, action, next }: { graceUntil: string; action: KeepAction; next: string }) {
  return (
    <GuestScreen header="events" sheet={{ variant: "account" }} labelledBy="deleting-title">
      <KeepAccountPanel
        titleId="deleting-title"
        graceUntil={graceUntil}
        action={action}
        next={next}
        secondary={
          <CtaLink href={accountLinks.calendar()} secondary>
            Not now
          </CtaLink>
        }
      />
    </GuestScreen>
  );
}
