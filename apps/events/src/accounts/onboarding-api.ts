/**
 * The onboarding transport the screens call. Lane A owns the routes (docs/event-model-v2.md, "Transport and
 * actions"): GET /api/me/onboarding, POST /api/me/onboarding/face, PATCH /api/me/profile (transport: api-client.ts).
 * Frames and tests pass a fixture implementation instead.
 */
import { apiCall as call } from "./api-client";
import type { ApiResult, ConsentInput, FacePurpose, OnboardingView, ProfilePatch, VerificationLaunch } from "./onboarding";

export interface OnboardingApi {
  /** Read-only: never creates a session or spends money (safe to poll). */
  refresh(): Promise<ApiResult<OnboardingView>>;
  saveProfile(patch: ProfilePatch): Promise<ApiResult<OnboardingView>>;
  /** Ensure (create or reuse) the liveness-only session; `returnTo` is a same-origin path. */
  startFace(input: { purpose: FacePurpose; consent: ConsentInput; returnTo: string }): Promise<ApiResult<VerificationLaunch>>;
}

/** `csrf` is read at call time (the session-bound token can rotate while the page is open). */
export function httpOnboardingApi(csrf: () => string): OnboardingApi {
  return {
    refresh: () => call<OnboardingView>("/api/me/onboarding", { method: "GET" }, csrf),
    saveProfile: (patch) => call<OnboardingView>("/api/me/profile", { method: "PATCH", body: JSON.stringify(patch) }, csrf),
    startFace: (input) => call<VerificationLaunch>("/api/me/onboarding/face", { method: "POST", body: JSON.stringify(input) }, csrf),
  };
}
