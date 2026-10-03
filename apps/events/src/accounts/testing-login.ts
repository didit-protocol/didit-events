// Explicit fixtures for UI-only tests. Never imported by application routes.
import type { CodeCheck } from "./types";
import { MARIA_EMAIL } from "./fixtures";
import { findEvent } from "../public/fixtures";

/** Didit email OTP facts (implementation-plan §0): 5-minute code, 3 attempts, one resend. */
export const CODE_TTL_MINUTES = 5;
export const RESEND_AFTER_SECONDS = 30;
export const LOCK_MINUTES = 15;

/** The fixture code (M-01 shows "481 903"). */
const STUB_CODE = "481903";

export type SendResult = { ok: true; resendInSeconds: number; sentAt: string } | { ok: false; reason: "locked"; retryAt: string };

export async function sendCode(email: string, _resend = false): Promise<SendResult> {
  const now = new Date();
  if (email.startsWith("locked@")) return { ok: false, reason: "locked", retryAt: new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() };
  attempts.delete(email);
  return { ok: true, resendInSeconds: RESEND_AFTER_SECONDS, sentAt: now.toISOString() };
}

// Wrong-code attempts are counted on the server, per email (stub: in memory; B2: the otp_challenges row). The client
// never supplies the remaining budget, so replaying an old action state cannot reset the lockout.
const MAX_ATTEMPTS = 3;
const attempts = new Map<string, number>();

export async function checkCode(email: string, code: string): Promise<CodeCheck> {
  const used = attempts.get(email) ?? 0;
  if (used >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };
  if (code === STUB_CODE) {
    attempts.delete(email);
    return { ok: true, isNew: email !== MARIA_EMAIL, linkedGoogle: false };
  }
  if (code === "000000") return { ok: false, reason: "expired" };
  attempts.set(email, used + 1);
  if (used + 1 >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };
  return { ok: false, reason: "wrong", attemptsLeft: MAX_ATTEMPTS - used - 1 };
}

/** Test hook: forget every counted attempt. */
export function resetAllCodeAttempts(): void {
  attempts.clear();
}

/** A new code resets the attempt budget (called by sendCode). Exported for tests. */
export function resetCodeAttempts(email: string): void {
  attempts.delete(email);
}

/** Creates the guest session after a passed code (B2). */
export async function startSession(_email: string): Promise<void> {}

/** The event a sign-in is for, when `next` points at one (chip, sheet backdrop, "Request to join" title). */
export async function eventForNext(next: string) {
  const slug = /^\/(?:e|me\/events)\/([a-z0-9-]+)/.exec(next)?.[1];
  return slug ? findEvent(slug) : undefined;
}

/** The signed-in guest (U-19 needs the email and initials). */
export { currentGuest } from "./session";
