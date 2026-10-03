"use client";

import { CsrfField } from "../../auth/CsrfField";

import { useActionState, useId, useState } from "react";
import { Button, EmailField, Textarea, TextField } from "@didit-events/ui";
import type { PublicEvent } from "../../public/types";
import type { ProfileFormState } from "../types";
import { Consent } from "./Consent";
import { Callout, EventChip, Eyebrow, GoogleMark, GuestScreen, SecuredByDidit, Spacer, Title, styles as s } from "./Screen";

export type ProfileAction = (prev: ProfileFormState, form: FormData) => Promise<ProfileFormState>;

export interface ProfileFormProps {
  event: PublicEvent;
  email: string;
  /** google = name and email come from Google and are locked (U-14); email = typed after the email code (U-15). */
  method: "google" | "email";
  initial: ProfileFormState;
  action: ProfileAction;
  /** Frame gallery: the focused field (U-14 Role, U-15 Full name). */
  focus?: "fullName" | "role";
}

/** "Tell the hosts about you" (05 U-14…U-16): the one-time profile after a first sign-in, then the request. */
export function ProfileForm({ event, email, method, initial, action, focus }: ProfileFormProps) {
  const titleId = useId();
  const consentId = useId();
  const [state, dispatch, pending] = useActionState(action, initial);
  const [values, setValues] = useState(() => ({ fullName: "", company: "", role: "", why: "", consent: false, ...initial.values }));
  const errors = state.errors ?? {};
  const count = Object.keys(errors).length;
  const google = method === "google";
  // Consent is checked on submit (U-16); only a missing name keeps the button off (U-15).
  const ready = google || Boolean(values.fullName);
  const lock = (
    <span className={s.lockNote}>
      <GoogleMark size={12} />
      From Google
    </span>
  );
  return (
    <GuestScreen header="events" sheet={{ event, variant: "flow" }} labelledBy={titleId}>
      <EventChip event={event} />
      {count ? null : <Eyebrow>{google ? "ACCOUNT CREATED · ONE LAST STEP" : "EMAIL CONFIRMED · ONE LAST STEP"}</Eyebrow>}
      <Title id={titleId} size={24}>
        Tell the hosts about you
      </Title>
      {count ? <Callout tone="danger">{`Check the ${count} highlighted ${count === 1 ? "item" : "items"}.`}</Callout> : null}
      <form action={dispatch} className={s.form} style={{ flex: 1 }} noValidate><CsrfField />
        <input type="hidden" name="slug" value={event.slug} />
        {google ? <input type="hidden" name="nameLocked" value="1" /> : null}
        {google ? (
          <div className={s.lockWrap}>
            <TextField name="fullName" label="Full name" size="xl" value={values.fullName} readOnly />
            {lock}
          </div>
        ) : (
          <TextField
            name="fullName"
            label="Full name"
            size="xl"
            placeholder="As on your ID"
            autoComplete="name"
            value={values.fullName}
            onChange={(e) => setValues({ ...values, fullName: e.target.value })}
            error={errors.fullName}
            required
            autoFocus
            state={focus === "fullName" ? "focus" : undefined}
          />
        )}
        {google ? (
          <div className={s.lockWrap}>
            <EmailField name="email" label="Email" size="xl" value={email} readOnly />
            {lock}
          </div>
        ) : count ? null : (
          <EmailField name="email" label="Email" size="xl" value={email} readOnly />
        )}
        <TextField name="company" label="Company" size="xl" placeholder="Where you work" autoComplete="organization" value={values.company} onChange={(e) => setValues({ ...values, company: e.target.value })} />
        <TextField
          name="role"
          label="Role"
          size="xl"
          placeholder="What you do"
          autoComplete="organization-title"
          value={values.role}
          onChange={(e) => setValues({ ...values, role: e.target.value })}
          autoFocus={google}
          state={focus === "role" ? "focus" : undefined}
        />
        {google ? (
          <Textarea name="why" label="Why do you want to come? · optional" size="xl" placeholder="One line helps the hosts decide" maxLength={280} value={values.why} onChange={(e) => setValues({ ...values, why: e.target.value })} />
        ) : null}
        <Consent id={consentId} terms invalid={Boolean(errors.consent)} checked={values.consent} onChange={(on) => setValues({ ...values, consent: on })} />
        <Spacer />
        <Button type="submit" size="xl" block disabled={!ready && !count} loading={pending}>
          {pending ? "Sending request…" : "Send request"}
        </Button>
        <SecuredByDidit />
      </form>
    </GuestScreen>
  );
}
