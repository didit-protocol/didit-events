import { CONTACT_EMAIL } from "../config";
/**
 * Guest onboarding (event model v2, "Onboarding state machine"): email proven → profile → face check → done, then
 * a one-tap Request to join. Everything the screens show is derived from the server's `OnboardingView` on every
 * read; this module only maps that view to a screen, validates the profile form the way the server will (parity
 * with `profileSchema` is tested, without shipping zod to the browser), and paces status polling.
 *
 * Types come from lane A's frozen contract (`@didit-events/core/contracts/event-model`), imported type-only.
 */
import type {
  ApiErrorCode,
  ApiResult,
  ConsentInput,
  FacePurpose,
  OnboardingStep,
  OnboardingView,
  Profile,
  ProofCheck,
  VerificationBadge,
  VerificationLaunch,
} from "@didit-events/core/contracts/event-model";
import type { profilePatchSchema } from "@didit-events/core/domain/event-model";
import type { z } from "zod";

export type { ApiErrorCode, ApiResult, ConsentInput, FacePurpose, OnboardingStep, OnboardingView, Profile, ProofCheck, VerificationBadge, VerificationLaunch };
export type ProfileLink = Profile["links"][number];
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

/* ── Profile form (mirrors profileSchema: code points, HTTPS links, LinkedIn host) ─────────────────────────── */

export const PROFILE_LIMITS = { fullName: 240, headline: 80, company: 120, jobRole: 120, bio: 160 } as const;

export interface ProfileFormValues {
  fullName: string;
  headline: string;
  company: string;
  bio: string;
  linkedin: string;
  website: string;
}

export type ProfileFormField = keyof ProfileFormValues;
export type ProfileFormErrors = Partial<Record<ProfileFormField | "links", string>>;

/** Unicode code points, like PostgreSQL `char_length` (an emoji counts once). */
export const codePoints = (s: string) => Array.from(s).length;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const PROSE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

/** "linkedin.com/in/maria" → "https://linkedin.com/in/maria"; http is upgraded, other schemes refused (null). */
export function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v.replace(/^http:\/\//i, "https://") : `https://${v}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") || /\s/.test(v)) return null;
  return url.href.length > 2048 ? null : url.href;
}

export const isLinkedInUrl = (href: string) => {
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(href).hostname);
  } catch {
    return false;
  }
};

/** The form's two link inputs from saved links (first LinkedIn, first website/other). */
export function linkInputs(links: ProfileLink[] | undefined): { linkedin: string; website: string } {
  const list = links ?? [];
  return { linkedin: list.find((l) => l.kind === "linkedin")?.href ?? "", website: list.find((l) => l.kind !== "linkedin")?.href ?? "" };
}

/** Initial form values: the saved profile (resume after drop-off), else empty. */
export function profileFormValues(profile: Partial<Profile>): ProfileFormValues {
  return {
    fullName: profile.fullName ?? "",
    headline: profile.headline ?? "",
    company: profile.company ?? "",
    bio: profile.bio ?? "",
    ...linkInputs(profile.links),
  };
}

/** Client-side check with the server's rules, so errors show before a round trip. The server re-validates. */
export function validateProfileForm(v: ProfileFormValues): ProfileFormErrors {
  const errors: ProfileFormErrors = {};
  const line = (k: "fullName" | "headline" | "company", empty: string) => {
    const t = v[k].trim();
    if (!t) errors[k] = empty;
    else if (codePoints(t) > PROFILE_LIMITS[k]) errors[k] = `Keep it under ${PROFILE_LIMITS[k]} characters`;
    else if (CONTROL.test(t)) errors[k] = "Remove the special characters";
  };
  line("fullName", "Enter your name");
  line("headline", "Add your role, for example “Founder & CEO”");
  line("company", "Add your company, or “Independent”");
  // Flow v3: the bio is optional (still limited and free of control characters when given).
  if (codePoints(v.bio) > PROFILE_LIMITS.bio) errors.bio = `Keep it under ${PROFILE_LIMITS.bio} characters`;
  else if (PROSE_CONTROL.test(v.bio)) errors.bio = "Remove the special characters";
  const li = v.linkedin.trim() ? normalizeUrl(v.linkedin) : null;
  const web = v.website.trim() ? normalizeUrl(v.website) : null;
  if (v.linkedin.trim() && (!li || !isLinkedInUrl(li))) errors.linkedin = "Paste your LinkedIn profile link (linkedin.com/in/…)";
  if (v.website.trim() && !web) errors.website = "Enter a website starting with https://";
  if (!v.linkedin.trim() && !v.website.trim()) errors.links = "Add your LinkedIn or a website";
  else if (li && web && li === web) errors.website = "Use a different link from your LinkedIn";
  return errors;
}

/**
 * Flow v3 asks for ONE link ("linkedin.com/in/yourname" or any website): a LinkedIn URL fills the LinkedIn slot,
 * anything else the website slot.
 */
export function withSingleLink(v: ProfileFormValues, link: string): ProfileFormValues {
  const href = normalizeUrl(link);
  return href && isLinkedInUrl(href) ? { ...v, linkedin: link, website: "" } : { ...v, linkedin: "", website: link };
}

/** The PATCH body for a valid form (links as the contract's {kind,label,href}). */
export function profilePatch(v: ProfileFormValues, expectedProfileVersion: number): ProfilePatch {
  const links: ProfileLink[] = [];
  const li = normalizeUrl(v.linkedin);
  const web = normalizeUrl(v.website);
  if (li) links.push({ kind: "linkedin", label: "LinkedIn", href: li });
  if (web) links.push(isLinkedInUrl(web) ? { kind: "linkedin", label: "LinkedIn", href: web } : { kind: "website", label: "Website", href: web });
  return { fullName: v.fullName.trim(), headline: v.headline.trim(), company: v.company.trim(), bio: v.bio.trim(), links, expectedProfileVersion };
}

/**
 * After a request: the optional profile (headline, bio, LinkedIn, website or X, photo) still has a gap, so the modal
 * offers "Make your profile stand out". A complete profile skips the step.
 */
export function profileBoostNeeded(view: Pick<OnboardingView, "profile" | "photoUrl">): boolean {
  return profileSubSteps(view).length > 0;
}

export type ProfileSubStep = "photo" | "about" | "links";

/** The profile screens after a request, one per gap, in order: photo, headline + bio, LinkedIn + website or X. */
export function profileSubSteps(view: Pick<OnboardingView, "profile" | "photoUrl">): ProfileSubStep[] {
  const { linkedin, website } = linkInputs(view.profile.links);
  const steps: ProfileSubStep[] = [];
  if (!view.photoUrl) steps.push("photo");
  if (!view.profile.headline?.trim() || !view.profile.bio?.trim()) steps.push("about");
  if (!linkedin || !website) steps.push("links");
  return steps;
}

/**
 * The boost step's PATCH: headline, bio and the two link slots only (name and company are untouched). Links beyond
 * the two slots the form shows are kept.
 */
export function boostPatch(v: Pick<ProfileFormValues, "headline" | "bio" | "linkedin" | "website">, profile: Partial<Profile>, expectedProfileVersion: number): ProfilePatch {
  const slots = linkInputs(profile.links);
  const fresh = profilePatch({ fullName: "", company: "", ...v }, expectedProfileVersion).links ?? [];
  const kept = (profile.links ?? []).filter((l) => l.href !== slots.linkedin && l.href !== slots.website && !fresh.some((f) => f.href === l.href));
  return { headline: v.headline.trim(), bio: v.bio.trim(), links: [...fresh, ...kept].slice(0, 8), expectedProfileVersion };
}

/** Server field names (missingProfileFields, error.fields) → the form's fields. */
export function formField(server: string): ProfileFormField | "links" | null {
  if (server === "fullName" || server === "headline" || server === "company" || server === "bio") return server;
  if (server === "jobRole") return "headline";
  if (server === "links" || server.startsWith("links")) return "links";
  return null;
}

const FIELD_LABELS: Record<ProfileFormField | "links", string> = {
  fullName: "your name",
  headline: "your role",
  company: "your company",
  bio: "a short bio",
  linkedin: "your LinkedIn",
  website: "a website",
  links: "your LinkedIn or a website",
};

/** "your role and a short bio" for the resume callout. */
export function missingSentence(fields: string[]): string {
  const labels = [...new Set(fields.map(formField).filter((f): f is ProfileFormField | "links" => f !== null).map((f) => FIELD_LABELS[f]))];
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** The purpose the face launch asks for: renewal once a face has expired, first enrolment otherwise. */
export const facePurpose = (view: OnboardingView): FacePurpose => (view.step === "face_expired" || view.face?.state === "expired" ? "face_renewal" : "onboarding");

/** The hosted consent recorded with the launch (liveness only: no event extras at onboarding). */
export const faceConsent = (): ConsentInput => ({ disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, eventConsentAccepted: false, acceptedChecks: ["face"] });

/** Why the last face check did not pass, from the operation and badge (never a provider reason or score). */
export type FaceFailure = "expired" | "declined" | "revoked";
export function faceFailure(view: OnboardingView): FaceFailure {
  if (view.face?.state === "revoked") return "revoked";
  if (view.operation?.state === "expired" || view.operation?.state === "stale") return "expired";
  return "declined";
}

/* ── Polling ───────────────────────────────────────────────────────────────────────────────────────────────── */

/** 2 s, 3 s, 5 s, 8 s, then every 15 s: quick while a decision is likely, gentle once it is slow. */
export function pollDelayMs(attempt: number, retryAfterMs?: number): number {
  const steps = [2000, 3000, 5000, 8000];
  const base = steps[attempt] ?? 15000;
  return retryAfterMs && retryAfterMs > base ? Math.min(retryAfterMs, 60000) : base;
}

/** Blocked launches, in guest words. The profile is always kept. */
export function blockedCopy(code: Extract<VerificationLaunch, { state: "blocked" }>["code"]): { title: string; body: string } {
  switch (code) {
    case "provider_unavailable":
      return { title: "Didit is not reachable right now", body: "Your profile is saved. Try the face check again in a few minutes." };
    case "budget":
      return { title: "Face checks are paused for now", body: `Your profile is saved. Try again later, or email ${CONTACT_EMAIL}.` };
    case "review_required":
      return { title: "Your face check needs a review", body: "The team is taking a look. We email you when it is done." };
    case "consent_required":
      return { title: "Consent needed", body: "Continue again to agree to the Didit check, then it starts." };
  }
}

/** "María" from the saved full name (mononyms stay whole). */
export const firstNameOf = (view: Pick<OnboardingView, "profile">) => (view.profile.fullName ?? "").trim().split(/\s+/)[0] ?? "";

