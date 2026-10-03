import { cookies } from "next/headers";
import { COOKIE_NAMES } from "@didit-events/core/http/policy";
import { identity } from "../auth/runtime";

/**
 * v5: the account deletion this browser asked for, while it is still in its grace period (else null). Only the session
 * that requested it sees it; every other read treats that session as signed out. Never throws: a page must not fail
 * because the banner could not be read.
 */
export async function pendingDeletion(): Promise<{ graceUntil: string } | null> {
  const cookie = (await cookies()).get(COOKIE_NAMES.session)?.value;
  if (!cookie) return null;
  try {
    const pending = await identity.profile.pendingDeletion(cookie);
    return pending ? { graceUntil: pending.graceUntil.toISOString() } : null;
  } catch {
    return null;
  }
}
