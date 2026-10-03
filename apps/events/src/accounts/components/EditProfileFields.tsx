"use client";

import { CsrfField } from "../../auth/CsrfField";

import { useActionState, useEffect, useState } from "react";
import { useAdminRouter as useRouter } from "../../admin/useAdminRouter";
import { Button, Textarea, TextField, cx } from "@didit-events/ui";
import { accountLinks } from "../links";
import { fullName, nameVerified, type GuestAccount } from "../types";
import { Callout, Spacer } from "./Screen";
import { SocialChips, type SocialChip } from "./SocialChips";
import { httpSuggestSocial, useSocialSuggestions, type SuggestSocial } from "../social-suggest";
import s from "./Screen.module.css";
import a from "./Account.module.css";
import o from "./Onboarding.module.css";

export interface EditProfileState {
  error?: string;
  saved?: boolean;
  /** Changes on every successful save, so a second save shows the success state again. */
  savedAt?: number;
}
export type EditProfileAction = (prev: EditProfileState, form: FormData) => Promise<EditProfileState>;

const BIO_MAX = 160;

/**
 * The interactive part of 05 U-34: the save result, name, headline, bio and links. The name is locked only when an ID
 * document proved it; with the face check alone (a verified human, not a verified name) it stays editable.
 */
export function EditProfileFields({ account, action, focus, suggestSocial = httpSuggestSocial }: { account: GuestAccount; action: EditProfileAction; focus?: "bio"; suggestSocial?: SuggestSocial }) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [bio, setBio] = useState(account.bio ?? "");
  const [linkedin, setLinkedin] = useState(() => account.links.find((l) => l.label === "LinkedIn")?.href.replace(/^https:\/\//, "") ?? "");
  const [website, setWebsite] = useState(() => account.links.find((l) => l.label !== "LinkedIn")?.href ?? "");
  // "Is this you?" for the saved name and company; chips only fill an empty slot (X goes to "Website or X").
  const social = useSocialSuggestions(fullName(account), account.company ?? "", !linkedin.trim() || !website.trim(), suggestSocial);
  const chips: SocialChip[] = [
    ...(linkedin.trim() ? [] : social.suggestions.linkedin.map((c) => ({ ...c, network: "linkedin" as const, field: "linkedin" }))),
    ...(website.trim() ? [] : social.suggestions.x.slice(0, 1).map((c) => ({ ...c, network: "x" as const, field: "website" }))),
  ];
  const nameLocked = nameVerified(account);
  const router = useRouter();
  // A save changes the name/headline shown in the header and Settings: re-render the server components.
  useEffect(() => {
    if (state.savedAt) router.refresh();
  }, [state.savedAt, router]);
  return (
    <>
      {state.error ? (
        <Callout tone="danger">{state.error}</Callout>
      ) : state.saved && !pending ? (
        <Callout tone="success">
          Profile saved.{" "}
          <a href={accountLinks.profile()} style={{ color: "inherit", fontWeight: 500 }}>
            View your profile
          </a>
        </Callout>
      ) : null}
      <form action={dispatch} className={s.form} style={{ flex: 1 }}><CsrfField />
        {nameLocked ? (
          <div className={s.lockWrap}>
            <TextField label="Full name · verified by ID" size="xl" value={fullName(account)} readOnly />
            <a href={`${accountLinks.editProfile()}?change=name`} className={cx(s.lockNote, a.lockChange)}>
              Change
            </a>
          </div>
        ) : (
          <TextField name="fullName" label="Full name" size="xl" defaultValue={fullName(account)} autoComplete="name" />
        )}
        <TextField name="headline" label="Headline" size="xl" defaultValue={account.headline} maxLength={80} />
        <Textarea
          name="bio"
          label={`Bio · ${bio.length} / ${BIO_MAX}`}
          size="xl"
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
          maxLength={BIO_MAX}
          style={{ height: 88 }}
          state={focus === "bio" ? "focus" : undefined}
        />
        <TextField name="linkedin" label="LinkedIn" size="xl" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/in/…" />
        <TextField name="website" label="Website or X" size="xl" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" inputMode="url" />
        <SocialChips loading={social.loading} chips={chips} disabled={pending} collapseEmpty onPick={(c) => (c.network === "x" ? setWebsite(c.url) : setLinkedin(c.url.replace(/^https:\/\//, "")))} />
        <p className={o.disclosure}>We may look up your public LinkedIn and X to suggest them.</p>
        <Spacer />
        <Button type="submit" size="xl" block loading={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </>
  );
}
