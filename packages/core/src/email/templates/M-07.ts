import { assetsOf, defineTemplate, preferencesLink, type EmailBase } from "../common.ts";

export type M07Data = EmailBase;

export const M07 = defineTemplate<M07Data>({ code: "M-07", name: "Verification in review", trigger: "Didit webhook: In review" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: "We are checking your verification",
  preheader: "We will email you when the review is complete.",
  eyebrow: "IN REVIEW",
  headline: "Almost there",
  body: "Your required check needs review. We will email you when there is an update. You can return to your event to see its status.",
  blocks: [],
  footer: { legal: "You are verifying for a Didit event.", link: preferencesLink(d) },
}));
