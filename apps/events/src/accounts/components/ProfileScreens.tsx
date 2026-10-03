import { StatusPill, avatarInitial } from "@didit-events/ui";
import { fullDate } from "../format";
import { accountLinks } from "../links";
import { fullName, nameVerified, type GuestAccount } from "../types";
import { ActionButton, CtaLink, Eyebrow, Foot, GuestScreen, MetGlyph, RowGroup, Spacer, Title, type GroupRow } from "./Screen";
import { initialsOf } from "./StatusScreen";
import a from "./Account.module.css";
import { displayName } from "../../public/viewer-name";

/** What the face check proves: a real person. "Verified by Didit" is kept for a name an ID document proved. */
const verifiedLabel = (account: GuestAccount) => (nameVerified(account) ? "Verified by Didit" : "Human verified");

/**
 * The 104px profile photo with the blue "verified" tick. Without a photo it is the initial on brand-soft (the same
 * avatar Settings and Edit profile show) with an "Add photo" link under it, so the tick never sits on an empty slot.
 */
export function ProfilePhoto({ account }: { account: GuestAccount }) {
  const verified = account.verification.state !== "none";
  return (
    <>
      <div className={a.photo}>
        {account.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.photoUrl} alt="" width={104} height={104} className={a.photoImg} />
        ) : (
          <span className={`${a.photoImg} ${a.photoInitial}`} aria-hidden="true">
            {avatarInitial(displayName(account), account.email)}
          </span>
        )}
        {verified ? (
          <span className={a.tick} role="img" aria-label={verifiedLabel(account)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FEFEFE" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        ) : null}
      </div>
      {account.photoUrl ? null : (
        <a href={accountLinks.photo()} className={a.photoAdd}>
          Add photo
        </a>
      )}
    </>
  );
}

const verifiedRows = (account: GuestAccount): GroupRow[] => {
  const v = account.verification;
  const ok = v.state === "verified";
  const on = v.state !== "none" ? fullDate(v.verifiedAt) : "";
  const named = nameVerified(account);
  return [
    { key: "name", label: "Full name", detail: named ? "Verified · matches your ID document" : "Not verified · needs an ID document", action: <MetGlyph met={named} /> },
    { key: "email", label: "Email", detail: v.state !== "none" ? `Verified ${on}` : "Confirmed by sign-in code only", action: <MetGlyph met={v.state !== "none"} /> },
    {
      key: "selfie",
      label: "Selfie · liveness",
      detail: v.state === "verified" ? `Human verified · valid until ${fullDate(v.selfieValidUntil)}` : v.state === "selfie_expired" ? `Expired ${fullDate(v.selfieExpiredAt)}` : "Not verified",
      action: <MetGlyph met={ok} />,
    },
    { key: "doc", label: "ID document", detail: named ? "Verified" : "Not verified · not needed yet", action: <MetGlyph met={named} /> },
    { key: "age", label: "Age 18+", detail: "Not verified", action: <MetGlyph met={false} /> },
  ];
};

/** 05 U-32 (verified) and U-33 (new, not verified): the profile hosts see. */
export function ProfileScreen({ account }: { account: GuestAccount }) {
  const verified = account.verification.state !== "none";
  const chips = [...account.links.map((l) => ({ label: l.label, href: l.href })), ...(account.eventsAttended ? [{ label: `Attended ${account.eventsAttended} events`, href: "" }] : [])];
  return (
    <GuestScreen header="account" initials={initialsOf(account)} accountName={displayName(account)} account={account} labelledBy="profile-title">
      <Eyebrow>PROFILE</Eyebrow>
      <Title id="profile-title" size={26}>
        Your public profile
      </Title>
      <section className={a.profile} aria-labelledby="profile-name">
        <ProfilePhoto account={account} />
        <div className={a.names}>
          <h2 id="profile-name" className={a.name}>
            {displayName(account)}
          </h2>
          <p className={a.headline}>{account.headline}</p>
        </div>
        <StatusPill status={verified ? "profile-verified" : "profile-incomplete"}>{verified ? verifiedLabel(account) : "Not verified yet"}</StatusPill>
        <p className={a.bio}>{account.bio ?? "Add a short bio so hosts know who you are."}</p>
        {chips.length ? (
          <ul className={a.links}>
            {chips.map((c) => (
              <li key={c.label}>
                {c.href ? (
                  <a href={c.href} className={a.linkChip} rel="noopener noreferrer" target="_blank">
                    {c.label}
                  </a>
                ) : (
                  <span className={a.linkChip}>{c.label}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <RowGroup title="VERIFIED DATA" rows={verifiedRows(account)} />
      <Spacer />
      {verified ? (
        <CtaLink href={accountLinks.editProfile()} secondary>
          Edit profile
        </CtaLink>
      ) : (
        <CtaLink href={accountLinks.editProfile()}>Complete profile</CtaLink>
      )}
    </GuestScreen>
  );
}

/** 05 U-38: what Didit verified, and what it didn't. */
export function VerificationScreen({ account, deleteData }: { account: GuestAccount; deleteData: (form: FormData) => Promise<void> }) {
  const v = account.verification;
  const on = v.state !== "none" ? fullDate(v.verifiedAt) : "";
  const named = nameVerified(account);
  const verified: GroupRow[] =
    v.state === "none"
      ? []
      : [
          ...(named
            ? [
                { key: "name", label: `Full name · ${fullName(account)}`, detail: "Read from your ID document", action: <MetGlyph met /> },
                { key: "doc", label: "ID document", detail: "Checked by Didit", action: <MetGlyph met /> },
              ]
            : []),
          { key: "email", label: `Email · ${account.email}`, detail: `One-time code · ${on}`, action: <MetGlyph met /> },
          ...(v.state === "verified"
            ? [{ key: "selfie", label: "Human verified · liveness passed", detail: `Face ticket for check-in · valid until ${fullDate(v.selfieValidUntil)}`, action: <MetGlyph met /> }]
            : []),
        ];
  const missing: GroupRow[] = [
    ...(v.state === "selfie_expired" ? [{ key: "selfie", label: "Selfie · liveness", detail: `Expired ${fullDate(v.selfieExpiredAt)}`, action: <MetGlyph met={false} /> }] : []),
    ...(named
      ? []
      : [
          { key: "name", label: "Full name", detail: "Only an ID document verifies a name", action: <MetGlyph met={false} /> },
          { key: "doc", label: "ID document", detail: "Only if an event requires it", action: <MetGlyph met={false} /> },
        ]),
    { key: "age", label: "Age 18+", detail: "Only if an event requires it", action: <MetGlyph met={false} /> },
    { key: "phone", label: "Phone number", detail: "Only if an event requires it", action: <MetGlyph met={false} /> },
  ];
  return (
    <GuestScreen header="account" initials={initialsOf(account)} accountName={displayName(account)} account={account} labelledBy="verif-title">
      <Eyebrow>VERIFIED BY DIDIT</Eyebrow>
      <Title id="verif-title" size={24}>
        {v.state === "none" ? "Nothing verified yet" : "What Didit has verified"}
      </Title>
      {verified.length ? <RowGroup title="VERIFIED" rows={verified} /> : null}
      <RowGroup title="NOT VERIFIED" rows={missing} />
      <Spacer />
      {v.state !== "none" ? (
        <ActionButton action={deleteData} fields={{}} secondary pendingLabel="Asking Didit…">
          Delete verification data
        </ActionButton>
      ) : null}
      <Foot>Didit stores this. Didit Events only receives the results, never your ID images.</Foot>
    </GuestScreen>
  );
}
