"use client";

import { errorCopy } from "../../api-client";
import { useState, type FormEvent } from "react";
import { Button, Textarea, TextField, cx } from "@didit-events/ui";
import { accountLinks } from "../../links";
import type { OnboardingApi } from "../../onboarding-api";
import { boostPatch, codePoints, formField, PROFILE_LIMITS, profileFormValues, profileSubSteps, validateProfileForm, type OnboardingView, type ProfileFormErrors, type ProfilePatch, type ProfileSubStep } from "../../onboarding";
import { Callout, CtaLink, FlowIcon, Lead, RowAction, RowGroup, SheetFooter, Title, styles as s } from "../Screen";
import { PhotoUploader, type PhotoUploadAction } from "../PhotoUploader";
import { SocialChips, type SocialChip } from "../SocialChips";
import { httpSuggestSocial, useSocialSuggestions, type SuggestSocial } from "../../social-suggest";
import { StepBar, StepBody, StepPane } from "./Step";
import o from "../Onboarding.module.css";

export interface ProfileStepsProps {
  titleId: string;
  onboarding: OnboardingView;
  profileApi: OnboardingApi;
  /** The /me/profile photo actions; without them the photo step links to the photo page instead. */
  photo?: { upload: PhotoUploadAction; remove: PhotoUploadAction };
  /** "Back to event" on the last screen (closes the modal); without it the screen links to `backHref`. */
  onClose?: () => void;
  backHref: string;
  /** Frames: open on a sub-step or on the last screen. */
  initialStep?: number | "done";
  /** "Is this you?" lookups on the links screen (tests and frames pass a fixture). */
  suggestSocial?: SuggestSocial;
}

type Field = "headline" | "bio" | "linkedin" | "website";
const FIELDS: Record<Exclude<ProfileSubStep, "photo">, ReadonlySet<string>> = {
  about: new Set(["headline", "bio"]),
  links: new Set(["linkedin", "website", "links"]),
};

const COPY: Record<ProfileSubStep, { title: string; lead: string }> = {
  photo: { title: "Add a photo", lead: "Hosts see it next to your request. It is never used for check-in." },
  about: { title: "Your headline and bio", lead: "A line about what you do helps the hosts say yes." },
  links: { title: "Your links", lead: "LinkedIn and a website or X, so the hosts know who is coming." },
};

/**
 * "Complete your profile" after a request (the request has already gone out: nothing here blocks it). One screen per
 * gap — photo, headline + bio, LinkedIn + website or X — with dots, Next / Skip and Back. Next saves that screen
 * through PATCH /api/me/profile with the profile form's validation (errors inline); then "Profile done".
 */
export function ProfileSteps({ titleId, onboarding, profileApi, photo, onClose, backHref, initialStep = 0, suggestSocial = httpSuggestSocial }: ProfileStepsProps) {
  // Fixed when the step opens: saving a screen must not reshuffle the dots.
  const [steps] = useState(() => {
    const gaps = profileSubSteps(onboarding);
    return gaps.length ? gaps : (["about"] as ProfileSubStep[]);
  });
  const [at, setAt] = useState<number | "done">(initialStep);
  const [back, setBack] = useState(false);
  const [view, setView] = useState(onboarding);
  const [values, setValues] = useState(() => {
    const v = profileFormValues(onboarding.profile);
    return { headline: v.headline, bio: v.bio, linkedin: v.linkedin, website: v.website };
  });
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const onLinks = at !== "done" && steps[at] === "links";
  const social = useSocialSuggestions(view.profile.fullName ?? "", view.profile.company ?? "", onLinks && (!values.linkedin.trim() || !values.website.trim()), suggestSocial);
  // Chips only for an empty slot: a link the guest typed is never replaced. X goes to "Website or X".
  const chips: SocialChip[] = [
    ...(values.linkedin.trim() ? [] : social.suggestions.linkedin.map((c) => ({ ...c, network: "linkedin" as const, field: "linkedin" }))),
    ...(values.website.trim() ? [] : social.suggestions.x.slice(0, 1).map((c) => ({ ...c, network: "x" as const, field: "website" }))),
  ];

  const go = (next: number | "done", backwards = false) => {
    setErrors({});
    setNotice(null);
    setBack(backwards);
    setAt(next);
  };
  const forward = (i: number) => go(i + 1 < steps.length ? i + 1 : "done");
  const set = (k: Field) => (v: string) => {
    setValues((old) => ({ ...old, [k]: v }));
    if (errors[k] || (errors.links && (k === "linkedin" || k === "website"))) setErrors((old) => ({ ...old, [k]: undefined, links: k === "linkedin" || k === "website" ? undefined : old.links }));
  };

  if (at === "done")
    return (
      <StepPane step="done" titleId={titleId} enter="change">
        <StepBody align="center">
          <div className={o.result} role="status">
            <FlowIcon status="success" />
            <Title id={titleId} size={24} as="h2">
              {saved ? "Profile done" : "You can finish it later"}
            </Title>
            <Lead>{saved ? "Hosts see it with your request." : "Your profile is on your account page whenever you want it."}</Lead>
          </div>
        </StepBody>
        <SheetFooter>
          {onClose ? (
            <Button size="xl" block onClick={onClose}>
              Back to event
            </Button>
          ) : (
            <CtaLink href={backHref}>Back to event</CtaLink>
          )}
        </SheetFooter>
      </StepPane>
    );

  const index = at;
  const step = steps[index]!;

  async function next(e: FormEvent) {
    e.preventDefault();
    if (step === "photo") {
      // The uploader saves the photo itself, as on /me/profile.
      setSaved(true);
      return forward(index);
    }
    const shown = FIELDS[step];
    const all = validateProfileForm({ ...profileFormValues(view.profile), ...values });
    const found: ProfileFormErrors = Object.fromEntries(Object.entries(all).filter(([k]) => shown.has(k)));
    setErrors(found);
    if (Object.keys(found).length) return;
    const full = boostPatch(values, view.profile, view.profileVersion);
    const patch: ProfilePatch =
      step === "about" ? { headline: full.headline, bio: full.bio, expectedProfileVersion: full.expectedProfileVersion } : { links: full.links, expectedProfileVersion: full.expectedProfileVersion };
    const current = step === "about" ? { headline: view.profile.headline ?? "", bio: view.profile.bio ?? "" } : { links: view.profile.links ?? [] };
    const changed = Object.entries(current).some(([k, v]) => JSON.stringify(v) !== JSON.stringify(patch[k as keyof ProfilePatch]));
    if (!changed) return forward(index);
    setSaving(true);
    setNotice(null);
    const res = await profileApi.saveProfile(patch);
    setSaving(false);
    if (res.ok) {
      setView(res.data);
      setSaved(true);
      return forward(index);
    }
    if (res.error.code === "context_changed") {
      const fresh = await profileApi.refresh();
      if (fresh.ok) setView(fresh.data);
      return setNotice("Your profile changed in another tab. Check it and save again.");
    }
    const fieldErrors: ProfileFormErrors = {};
    for (const [k, msg] of Object.entries(res.error.fields ?? {})) {
      const f = formField(k);
      if (f && shown.has(f)) fieldErrors[f] = msg;
    }
    if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
    else setNotice(errorCopy(res.error));
  }

  const bioLength = codePoints(values.bio);
  return (
    <StepPane step={step} titleId={titleId} back={back} enter="change">
      {/* The form is the whole screen: its fields scroll in the body, Skip and Next stay in the footer. */}
      <form className={cx(s.form, s.fill)} onSubmit={next} noValidate data-profile-step={step}>
        <StepBody>
          <StepBar index={index} total={steps.length} onBack={index > 0 && !saving ? () => go(index - 1, true) : undefined} />
          <Title id={titleId} size={24} as="h2">
            {COPY[step].title}
          </Title>
          <Lead>{COPY[step].lead}</Lead>
          {notice ? <Callout tone="warning">{notice}</Callout> : null}
          {step === "photo" ? (
            photo ? (
              <PhotoUploader name={view.profile.fullName ?? ""} email={view.email.address} photoUrl={view.photoUrl ?? undefined} upload={photo.upload} remove={photo.remove} />
            ) : (
              <RowGroup title="PHOTO" rows={[{ label: "Profile photo", detail: "JPG or PNG, up to 5 MB.", action: <RowAction href={accountLinks.photo()}>Add</RowAction> }]} />
            )
          ) : step === "about" ? (
            <>
              <TextField name="headline" label="Headline" size="lg" placeholder="e.g. Founder & CEO" value={values.headline} onChange={(e) => set("headline")(e.target.value)} error={errors.headline} maxLength={PROFILE_LIMITS.headline} readOnly={saving} />
              <Textarea
                name="bio"
                label={`Bio · ${bioLength} / ${PROFILE_LIMITS.bio}`}
                value={values.bio}
                onChange={(e) => set("bio")(Array.from(e.target.value).slice(0, PROFILE_LIMITS.bio).join(""))}
                error={errors.bio}
                maxLength={PROFILE_LIMITS.bio}
                rows={3}
                readOnly={saving}
              />
            </>
          ) : (
            <>
              <TextField name="linkedin" label="LinkedIn" size="lg" inputMode="url" placeholder="linkedin.com/in/…" value={values.linkedin} onChange={(e) => set("linkedin")(e.target.value)} error={errors.linkedin ?? errors.links} readOnly={saving} />
              <TextField name="website" label="Website or X" size="lg" inputMode="url" placeholder="https://" value={values.website} onChange={(e) => set("website")(e.target.value)} error={errors.website} readOnly={saving} />
              <SocialChips loading={social.loading} chips={chips} disabled={saving} onPick={(c) => set(c.field as Field)(c.url)} />
              <p className={o.disclosure}>We may look up your public LinkedIn and X to suggest them.</p>
            </>
          )}
        </StepBody>
        <SheetFooter>
          <Button type="button" size="lg" block variant="secondary" onClick={() => forward(index)} disabled={saving}>
            Skip
          </Button>
          <Button type="submit" size="xl" block loading={saving}>
            {saving ? "Saving…" : "Next"}
          </Button>
        </SheetFooter>
      </form>
    </StepPane>
  );
}
