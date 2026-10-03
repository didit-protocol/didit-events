/**
 * The design states of the two client flows, by frame code: sign-in (05 U-01…U-13, DA-01…DA-05, 04 R-33) and the
 * signed-out request (04 R-01…R-09). The /_frames gallery renders them, and /login and /e/[slug]/register show them
 * with `?preview=<code>` (dev, test, FRAMES=1).
 */
import { MARIA_EMAIL, REGISTER_FILLED } from "./fixtures";
import type { RegisterState, SignInStep } from "./types";

const EMAIL = MARIA_EMAIL;
/** 17:30 CEST on the frame clock. */
const SENT_AT = "2026-10-08T17:30:00+02:00";

export interface SignInPreview {
  layout: "sheet" | "modal";
  initial: SignInStep;
  googlePending?: boolean;
  signingIn?: boolean;
  focus?: boolean;
  code?: string;
}

export const SIGN_IN_STATES: Record<string, SignInPreview> = {
  "U-01": { layout: "sheet", initial: { step: "choose" } },
  "U-03": { layout: "sheet", initial: { step: "choose" }, googlePending: true },
  "U-04": { layout: "sheet", initial: { step: "choose", banner: "google_cancelled" } },
  "U-05": { layout: "sheet", initial: { step: "choose", banner: "google_failed" } },
  "U-06": { layout: "sheet", initial: { step: "email", email: "maria.garcia@gm" }, focus: true },
  "U-07": { layout: "sheet", initial: { step: "email", email: "maria.garcia@gmail", error: "Enter a valid email address" } },
  "U-08": { layout: "sheet", initial: { step: "code", email: EMAIL, status: "sent", attemptsLeft: 3, resendInSeconds: 30, sentAt: SENT_AT }, code: "481" },
  "U-09": { layout: "sheet", initial: { step: "locked", email: EMAIL, retryAt: "2026-10-08T18:31:00+02:00", minutes: 15, scope: "email" } },
  "U-10": { layout: "sheet", initial: { step: "code", email: EMAIL, status: "wrong", attemptsLeft: 2, resendInSeconds: 0 }, code: "481930" },
  "U-11": { layout: "sheet", initial: { step: "code", email: EMAIL, status: "expired", resendInSeconds: 0 } },
  "U-12": { layout: "sheet", initial: { step: "code", email: EMAIL, status: "resent", attemptsLeft: 3, resendInSeconds: 59, sentAt: SENT_AT } },
  "U-13": { layout: "sheet", initial: { step: "signing_in" }, signingIn: true },
  "U-23": { layout: "sheet", initial: { step: "choose", banner: "session_expired" } },
  "R-33": { layout: "sheet", initial: { step: "locked", email: EMAIL, retryAt: "2026-10-08T17:45:00+02:00", minutes: 15, scope: "ip" } },
  "DA-01": { layout: "modal", initial: { step: "choose" } },
  "DA-02": { layout: "modal", initial: { step: "choose", email: "maria.garcia@gmail", error: "Enter a valid email address" } },
  "DA-03": { layout: "modal", initial: { step: "code", email: EMAIL, status: "sent", attemptsLeft: 3, resendInSeconds: 30, sentAt: SENT_AT } },
  "DA-04": { layout: "modal", initial: { step: "choose", banner: "google_failed" } },
  "DA-05": { layout: "modal", initial: { step: "code", email: EMAIL, status: "expired", resendInSeconds: 0 } },
};

export interface RegisterPreview {
  initial: RegisterState;
  sending?: boolean;
  focus?: boolean;
  code?: string;
}

const PARTIAL = { fullName: "", email: "maria.garcia@gmail", company: "Globex", role: "Head of Risk", consent: false };

export const REGISTER_STATES: Record<string, RegisterPreview> = {
  "R-01": { initial: { step: "form", values: {} }, focus: true },
  "R-02": { initial: { step: "form", values: PARTIAL, errors: { fullName: "Enter your name", email: "Enter a valid email address", consent: "Tick the box to continue" } } },
  "R-03": { initial: { step: "form", values: REGISTER_FILLED }, sending: true },
  "R-04": { initial: { step: "code", values: REGISTER_FILLED, status: "sent", attemptsLeft: 3, resendInSeconds: 42, sentAt: SENT_AT }, code: "481" },
  "R-05": { initial: { step: "code", values: REGISTER_FILLED, status: "wrong", attemptsLeft: 2, resendInSeconds: 0 }, code: "481930" },
  "R-06": { initial: { step: "code", values: REGISTER_FILLED, status: "expired", attemptsLeft: 3, resendInSeconds: 59, sentAt: "2026-10-08T18:14:00+02:00" } },
  "R-07": { initial: { step: "locked", values: REGISTER_FILLED, minutes: 15, scope: "email" } },
  "R-08": { initial: { step: "sent", firstName: "María", email: EMAIL, replyBy: "2026-10-02T18:00:00+02:00" } },
  "R-09": { initial: { step: "already", email: EMAIL, requestedAt: "2026-09-29T13:02:00+02:00", status: "pending approval" } },
};
