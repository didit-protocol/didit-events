/**
 * Data access for /e/[slug]/v/[token] (G-02), the personal verification link.
 *
 * B1 resolves hashed, registration-scoped tokens and maps authoritative evidence to the U4 view.
 * Starting the hosted flow also requires the matching B2 guest session and C14 browser policy.
 * Named demo tokens remain isolated to the frame gallery; plaintext tokens are never logged.
 */
import type { Invite } from "../../../../../src/public/types";
import { getVerificationRuntime } from "@didit-events/core";
import type { VerificationStart } from "@didit-events/core/verification/index";
import { verificationBrowserMutation, verificationEvent } from "../../../../../src/verification/server";

export async function getInvite(slug: string, token: string): Promise<Invite | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const link = await getVerificationRuntime().resolveLink(slug, token);
  return link ? { state: link.state, event: verificationEvent(link.event), firstName: link.firstName } : null;
}

/** Creates (or reuses) the Didit session for the link's registration and returns the hosted-flow URL (C4). */
export async function verificationUrlForLink(slug: string, token: string, form?: FormData): Promise<VerificationStart | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const auth = await verificationBrowserMutation(form);
  if (!auth) return { url: `/login?next=${encodeURIComponent(`/e/${slug}/v/${token}`)}` };
  const service = getVerificationRuntime();
  const link = await service.resolveLink(slug, token);
  if (!link || !["valid", "verified"].includes(link.state) || link.registration.accountId !== auth.principal.accountId) return null;
  return service.startForRegistration(auth.principal, slug, token);
}
