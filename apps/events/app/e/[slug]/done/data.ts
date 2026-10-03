/**
 * Data access for /e/[slug]/done (G-03), where Didit returns the guest after the hosted flow. The page only
 * displays state; the webhook and the reconciler (B1) are the only writers.
 *
 * B1 reads the signed-in B2 guest's verification and checks any provider session parameter against that account.
 * Evidence and provider/local status select the outcome. An unconfirmed retry allowance stays zero.
 */
import type { Outcome } from "../../../../src/public/types";
import { getVerificationRuntime, uuidPattern } from "@didit-events/core";
import { signedInGuest, verificationEvent } from "../../../../src/verification/server";

export async function getOutcome(slug: string, sessionId: string | undefined): Promise<Outcome | null> {
  if (sessionId && !uuidPattern.test(sessionId)) return null;
  const guest = await signedInGuest();
  if (!guest) return null;
  const outcome = await getVerificationRuntime().outcome(guest.accountId, slug, sessionId);
  return outcome ? { ...outcome, event: verificationEvent(outcome.event) } : null;
}
