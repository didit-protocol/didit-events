import { assetsOf, defineTemplate, preferencesLink, type EmailBase } from "../common.ts";
import { plural } from "../format.ts";

export interface M08Data extends EmailBase {
  retryUrl: string;
  attemptsLeft: number;
}

export const M08 = defineTemplate<M08Data>({ code: "M-08", name: "Verification declined · retry", trigger: "Didit webhook: Declined" }, (d) => ({
  variant: "event",
  assetsUrl: assetsOf(d),
  subject: "Your verification did not go through",
  preheader: d.attemptsLeft === 1 ? "You can try once more." : `You can try ${d.attemptsLeft} more times.`,
  eyebrow: "ACTION NEEDED",
  headline: "Let’s try that again",
  body: `A required check did not pass. Open your event status to review the result and available next steps. You have ${plural(d.attemptsLeft, "attempt")} left.`,
  blocks: [
    { kind: "buttons", primary: { label: "Try again", href: d.retryUrl } },
    { kind: "note", text: "Stuck? Reply to this email and the team will help." },
  ],
  footer: { legal: "You are verifying for a Didit event.", link: preferencesLink(d) },
}));
