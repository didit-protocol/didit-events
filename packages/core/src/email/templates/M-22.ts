import { assetsOf, defineTemplate, privacyLink, type EmailBase } from "../common.ts";
import { plural } from "../format.ts";

export interface M22Data extends EmailBase {
  cancelledPlaces: number;
  cancelledRequests: number;
}

export const M22 = defineTemplate<M22Data>({ code: "M-22", name: "Account deleted", trigger: "U-22" }, (d) => {
  const parts = [
    d.cancelledPlaces ? plural(d.cancelledPlaces, "upcoming place") : "",
    d.cancelledRequests ? plural(d.cancelledRequests, "request") : "",
  ].filter(Boolean);
  const cancelled = parts.length ? ` and cancelled ${parts.join(" and ")}` : "";
  return {
    variant: "account",
    assetsUrl: assetsOf(d),
    subject: "Your Didit Events account was deleted",
    preheader: parts.length ? "We cancelled your upcoming registrations." : "Your profile is gone.",
    eyebrow: "ACCOUNT DELETED",
    headline: "Your account is gone",
    body: `We deleted your Didit Events profile${cancelled}. We asked Didit to delete your verification data; they confirm within 30 days.`,
    blocks: [],
    footer: { legal: "Final email. We will not contact you again.", link: privacyLink(d) },
  };
});
