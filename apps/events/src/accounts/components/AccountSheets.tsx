import { accountLinks } from "../links";
import { DeleteAccountForm, NameChangeForm, type SheetAction, type SheetState } from "./AccountSheetForms";
import { CtaLink, FlowIcon, GuestScreen, Lead, Title } from "./Screen";
import a from "./Account.module.css";

export type { SheetAction, SheetState };

/** 05 U-22: delete the account. Typing DELETE enables the button. Server-rendered around the client form. */
export function DeleteAccountSheet({ upcoming, open, action, typed }: { upcoming: number; open: number; action: SheetAction; typed?: string }) {
  const parts = [upcoming ? `${upcoming} upcoming ${upcoming === 1 ? "place" : "places"}` : "", open ? `${open} open ${open === 1 ? "request" : "requests"}` : ""].filter(Boolean);
  return (
    <div className={a.sheetHost}>
      <GuestScreen header="events" sheet={{ variant: "account" }} labelledBy="delete-title">
        <FlowIcon status="error" icon="warning" />
        <Title id="delete-title" size={22}>
          Delete your account?
        </Title>
        <Lead>{`This ${parts.length ? `cancels ${parts.join(" and ")}, and ` : ""}removes your profile from Didit Events. Your Didit verification is managed by Didit; we ask them to delete it too.`}</Lead>
        <DeleteAccountForm
          action={action}
          typed={typed}
          secondary={
            <CtaLink href={accountLinks.settings()} secondary>
              Keep my account
            </CtaLink>
          }
        />
      </GuestScreen>
    </div>
  );
}

/** 05 U-37: changing a name Didit verified removes the verified mark. */
export function NameChangeSheet({ action, initialName }: { action: SheetAction; initialName?: string }) {
  return (
    <div className={a.sheetHost}>
      <GuestScreen header="events" sheet={{ variant: "account" }} labelledBy="name-title">
        <FlowIcon status="warning" />
        <Title id="name-title" size={22}>
          Change your verified name?
        </Title>
        <Lead>Your name was verified by Didit. Changing it removes the verified mark, and events that require a verified name will ask you to verify again.</Lead>
        <NameChangeForm
          action={action}
          initialName={initialName}
          secondary={
            <CtaLink href={accountLinks.editProfile()} secondary>
              Keep verified name
            </CtaLink>
          }
        />
      </GuestScreen>
    </div>
  );
}
