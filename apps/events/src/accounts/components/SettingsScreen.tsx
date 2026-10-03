import { Avatar, ButtonLink, cx } from "@didit-events/ui";
import { CsrfField } from "../../auth/CsrfField";
import { fullDate } from "../format";
import { accountLinks } from "../links";
import { nameVerified, type GuestAccount } from "../types";
import { Eyebrow, GuestScreen, RowAction, RowGroup, Title } from "./Screen";
import { initialsOf } from "./StatusScreen";
import s from "./Screen.module.css";
import a from "./Account.module.css";
import { displayName } from "../../public/viewer-name";

export interface SettingsActions {
  signOutAll?: (form: FormData) => Promise<void>;
  signOut: (form: FormData) => Promise<void>;
  toggleMarketing: (form: FormData) => Promise<void>;
  disconnectGoogle: (form: FormData) => Promise<void>;
}

/** Row buttons submit forms rendered after the list (a form can't sit inside the row's text). */
const submitTo = (form: string, label: string, cls: string | undefined) => (
  <button type="submit" form={form} className={cls}>
    {label}
  </button>
);

/** A switch that submits its form: the track and thumb (on = brand) in a 44px target, named by the row's label. */
const switchTo = (form: string, on: boolean, labelledBy: string) => (
  <button type="submit" form={form} className={a.switch} role="switch" aria-checked={on} aria-labelledby={labelledBy}>
    <span className={a.switchTrack} aria-hidden="true">
      <span className={a.switchThumb} />
    </span>
  </button>
);

/** A right-side row link with a 44px tap target (the shared RowAction is 17px tall text). */
const tapLink = (href: string, label: string) => (
  <a href={href} className={cx(s.rowAction, a.rowTap)}>
    {label}
  </a>
);

/**
 * PROFILE card: photo (or initial) + full name + headline; a new account without a name gets an empty state
 * that sends them to Edit profile. The primary email row follows either way.
 */
export function ProfileCard({ account }: { account: GuestAccount }) {
  const name = `${account.firstName ?? ""} ${account.lastName ?? ""}`.trim(); // empty → the "Add your name" state
  const detail = account.headline || [account.role, account.company].filter(Boolean).join(" · ");
  return (
    <section className={s.group} aria-labelledby="grp-profile">
      <h2 id="grp-profile" className={s.groupTitle} style={{ margin: 0 }}>
        PROFILE
      </h2>
      <ul className={s.box}>
        <li style={{ display: "contents" }}>
          {name ? (
            <div className={cx(s.row, a.cardRow)}>
              <Avatar name={name} email={account.email} src={account.photoUrl} size={48} tone="brand" />
              <span className={s.rowText}>
                <span className={s.rowLabel}>{name}</span>
                {detail ? <span className={s.rowDetail}>{detail}</span> : null}
              </span>
              {tapLink(accountLinks.editProfile(), "Edit")}
            </div>
          ) : (
            <div className={cx(s.row, a.cardEmpty)}>
              <Avatar name="" email={account.email} src={account.photoUrl} size={48} tone="brand" />
              <span className={s.rowText}>
                <span className={s.rowLabel}>Add your name and photo</span>
                <span className={s.rowDetail}>Hosts see them when you ask for a place.</span>
              </span>
              <ButtonLink href={accountLinks.editProfile()} variant="secondary" size="sm" className={a.tapButton}>
                Edit profile
              </ButtonLink>
            </div>
          )}
        </li>
        <li style={{ display: "contents" }}>
          <div className={s.row}>
            <span className={s.rowText}>
              <span className={s.rowLabel}>{account.email}</span>
              <span className={s.rowDetail}>Primary email · confirmed</span>
            </span>
          </div>
        </li>
      </ul>
    </section>
  );
}

/** 05 U-21 account settings: profile, sign-in methods (Google via Didit, email code), identity, account. */
export function SettingsScreen({ account, actions }: { account: GuestAccount; actions: SettingsActions }) {
  const v = account.verification;
  return (
    <GuestScreen header="account" initials={initialsOf(account)} accountName={displayName(account)} account={account} labelledBy="settings-title">
      <Eyebrow>YOUR ACCOUNT</Eyebrow>
      <Title id="settings-title" size={26}>
        Settings
      </Title>
      <ProfileCard account={account} />
      <RowGroup
        title="SIGN-IN METHODS"
        rows={[
          account.google
            ? { google: true, label: "Google", detail: account.google.email, action: submitTo("f-google", "Disconnect", cx(s.rowAction, s.rowActionMuted, a.rowTap)) }
            : { google: true, label: "Google", detail: "Not connected", action: tapLink(accountLinks.google(accountLinks.settings()), "Connect") },
          { label: "Email code", detail: "Always available for your primary email", action: <RowAction tone="on">On</RowAction> },
        ]}
      />
      <RowGroup
        title="IDENTITY"
        rows={[
          v.state === "none"
            ? { label: "Not verified yet", detail: "One quick selfie with Didit proves you're human, once for every event", action: tapLink(accountLinks.verification(), "Details") }
            : {
                label: nameVerified(account) ? "Verified by Didit" : "Human verified",
                labelTone: "success",
                detail: `${fullDate(v.verifiedAt)} · used for face check-in`,
                action: tapLink(accountLinks.verification(), "Manage"),
              },
        ]}
      />
      <RowGroup
        title="ACCOUNT"
        rows={[
          {
            label: <span id="marketing-label">Email me about new Didit events</span>,
            action: switchTo("f-marketing", account.marketingOptIn, "marketing-label"),
          },
          { label: submitTo("f-signout", "Sign out", cx(s.rowLabelButton, a.rowFill)) },
          ...(actions.signOutAll ? [{ label: submitTo("f-signout-all", "Sign out of all devices", cx(s.rowLabelButton, a.rowFill)) }] : []),
          { label: "Delete account", labelTone: "danger", detail: "Cancels upcoming registrations", href: accountLinks.deleteAccount() },
        ]}
      />
      <form id="f-google" action={actions.disconnectGoogle} hidden ><CsrfField /></form>
      <form id="f-marketing" action={actions.toggleMarketing} hidden><CsrfField />
        <input type="hidden" name="on" value={account.marketingOptIn ? "0" : "1"} />
      </form>
      <form id="f-signout" action={actions.signOut} hidden ><CsrfField /></form>
      {actions.signOutAll ? <form id="f-signout-all" action={actions.signOutAll} hidden><CsrfField /></form> : null}
    </GuestScreen>
  );
}
