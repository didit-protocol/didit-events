/**
 * Onboarding fixtures (event model v2 OnboardingView) for the /_frames gallery and the component tests: one view
 * per step and edge case, and an in-memory OnboardingApi. No network, no provider, no real session URLs.
 */
import type { OnboardingApi } from "./onboarding-api";
import type { OnboardingView, Profile, VerificationBadge, VerificationLaunch } from "./onboarding";

const EMAIL = "maria.garcia@gmail.com";

export const MARIA_PROFILE: Profile = {
  fullName: "María García",
  headline: "Head of Risk",
  company: "Globex",
  jobRole: "",
  bio: "Fraud and identity at a ride-hailing scale. Ex-Woodgrove Bank. Always up for a coffee about KYC.",
  links: [{ kind: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/in/mariagarcia/" }],
};

const FACE_OK: VerificationBadge = { check: "face", label: "Face check", state: "verified", verifiedAt: "2026-09-30T10:02:00Z", validUntil: "2027-03-29T10:02:00Z", source: "liveness" };
const FACE_EXPIRED: VerificationBadge = { ...FACE_OK, state: "expired", verifiedAt: "2026-03-01T10:02:00Z", validUntil: "2026-08-28T10:02:00Z" };

const base: OnboardingView = {
  step: "profile_required",
  onboardedAt: null,
  email: { address: EMAIL, verified: true },
  profile: {},
  profileVersion: 1,
  missingProfileFields: ["fullName", "headline", "company", "links"],
  photoUrl: null,
  face: null,
  operation: { id: "op-fixture", state: "active", expiresAt: "2026-10-01T10:00:00Z", canResume: true },
  returnTo: "/e/ai-era?join=1",
  canRequest: false,
};

const complete = (o: Partial<OnboardingView>): OnboardingView => ({ ...base, profile: MARIA_PROFILE, missingProfileFields: [], ...o });

export const ONBOARDING_VIEWS = {
  /** Just proved the email: the face session is already being prepared in the background. */
  profileNew: { ...base, operation: { ...base.operation!, state: "creating" } },
  /** Dropped off halfway through the profile. */
  profileResume: { ...base, profile: { fullName: "María García", company: "Globex" }, profileVersion: 2, missingProfileFields: ["headline", "links"] },
  faceRequired: complete({ step: "face_required", profileVersion: 2 }),
  faceCreating: complete({ step: "face_creating", operation: { ...base.operation!, state: "creating" } }),
  faceInProgress: complete({ step: "face_in_progress" }),
  faceInReview: complete({ step: "face_in_review", face: { ...FACE_OK, state: "in_review", verifiedAt: null, validUntil: null } }),
  faceDeclined: complete({ step: "face_failed", operation: { ...base.operation!, state: "failed", canResume: false } }),
  faceLinkExpired: complete({ step: "face_failed", operation: { ...base.operation!, state: "expired", canResume: false } }),
  faceExpired: complete({ step: "face_expired", onboardedAt: "2026-03-01T10:05:00Z", face: FACE_EXPIRED, operation: null, returnTo: "/me/events" }),
  complete: complete({ step: "complete", onboardedAt: "2026-09-30T10:05:00Z", face: FACE_OK, operation: null, canRequest: true }),
  completeGeneral: complete({ step: "complete", onboardedAt: "2026-09-30T10:05:00Z", face: FACE_OK, operation: null, canRequest: true, returnTo: "/events" }),
  signedOut: { ...base, step: "email_required", operation: null },
  unavailable: { ...base, step: "unavailable", operation: null },
} satisfies Record<string, OnboardingView>;

/** An in-memory API: `views` / `launches` are returned in order by refresh / startFace (the last one repeats). */
export function fixtureOnboardingApi(opts: { views?: OnboardingView[]; launch?: VerificationLaunch; launches?: VerificationLaunch[]; save?: (patch: Parameters<OnboardingApi["saveProfile"]>[0]) => OnboardingView } = {}): OnboardingApi & { calls: string[] } {
  const calls: string[] = [];
  const views = opts.views ?? [ONBOARDING_VIEWS.faceRequired];
  let i = 0;
  let l = 0;
  return {
    calls,
    async refresh() {
      calls.push("refresh");
      const v = views[Math.min(i++, views.length - 1)]!;
      return { ok: true, data: v };
    },
    async saveProfile(patch) {
      calls.push("saveProfile");
      return { ok: true, data: opts.save ? opts.save(patch) : ONBOARDING_VIEWS.faceRequired };
    },
    async startFace(input) {
      calls.push(`startFace:${input.purpose}`);
      const scripted = opts.launches ? opts.launches[Math.min(l++, opts.launches.length - 1)] : undefined;
      return { ok: true, data: scripted ?? opts.launch ?? { state: "ready", opId: "op-fixture", url: "https://verify.didit.me/session/fixture", expiresAt: "2026-10-01T10:00:00Z" } };
    },
  };
}
