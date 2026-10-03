import type { ConsentInput } from "@didit-events/core/contracts/event-model";
import { accountLinks } from "../links";
import s from "./Screen.module.css";

/**
 * The consent recorded with every sign-in (flow v3: no checkbox). Continuing IS the agreement: the disclosure below is
 * shown on screen, and its version travels with the receipt (`disclosureVersion`).
 */
export const ONBOARDING_CONSENT: ConsentInput = { disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, eventConsentAccepted: false, acceptedChecks: ["face"] };

/** events-profile-v2, in guest words. */
export const DISCLOSURE_TEXT =
  "By continuing you create a free Didit Events account. Didit takes one selfie to confirm you're a real person and recognise you at event doors; hosts of the events you request see your profile, never your selfie.";

export function OnboardingDisclosure({ className }: { className?: string }) {
  return (
    <p className={className ?? s.disclosureNote} data-disclosure-version={ONBOARDING_CONSENT.disclosureVersion}>
      {DISCLOSURE_TEXT} <a href={accountLinks.terms()}>Terms</a> · <a href={accountLinks.privacy()}>Privacy</a>
    </p>
  );
}
