import { CONTACT_EMAIL } from "../config";
/** Guest-area URLs (U5). The public ones (event, calendar, sign in, cancel, withdraw) live in ../public/links. */
import { links as publicLinks } from "../public/links";

export const accountLinks = {
  ...publicLinks,
  login: (next?: string, extra?: Record<string, string>) => {
    const safe = next ? safeNext(next, "") : "";
    const q = new URLSearchParams({ ...(safe ? { next: safe } : {}), ...extra }).toString();
    return q ? `/login?${q}` : "/login";
  },
  /** The Didit sign-in (OIDC, idp=google) start route (B2). */
  google: (next?: string) => {
    const safe = next ? safeNext(next, "") : "";
    return safe ? `/api/auth/oidc/start?idp=google&next=${encodeURIComponent(safe)}` : "/api/auth/oidc/start?idp=google";
  },
  me: () => "/me",
  myEvents: () => "/me/events",
  myEvent: (slug: string) => `/me/events/${slug}`,
  profile: () => "/me/profile",
  editProfile: () => "/me/profile/edit",
  photo: () => "/me/profile/photo",
  verification: () => "/me/profile/verification",
  settings: () => "/me/settings",
  deleteAccount: () => "/me/settings/delete",
  leaveWaitlist: (slug: string) => `/me/events/${slug}/cancel`,
  invite: (token: string) => `/i/${token}`,
  directions: (mapsUrl: string) => mapsUrl,
  contactEvents: () => `mailto:${CONTACT_EMAIL}`,
} as const;

/** `/e/<slug>?join=1`: the event page with the join modal open. */
export const joinHref = (slug: string) => `/e/${slug}?join=1`;

/**
 * The event whose join modal a same-origin path opens (`/e/<slug>?join=1`, or the old `/e/<slug>/register`), else null.
 * Sign-in returns straight there: the modal asks for whatever is still missing, so there is no onboarding page.
 */
export function joinSlug(path: string): string | null {
  let url: URL;
  try { url = new URL(path, PROBE_ORIGIN); } catch { return null; }
  if (url.origin !== PROBE_ORIGIN) return null;
  const page = /^\/e\/([a-z0-9-]+)$/.exec(url.pathname), register = /^\/e\/([a-z0-9-]+)\/register$/.exec(url.pathname);
  return page && url.searchParams.get("join") === "1" ? page[1]! : register ? register[1]! : null;
}

/** Where a guest lands after sign-in: the join modal when they came from one, the onboarding fallback when setup is
 * unfinished, else `next` (staff paths are never redirected). */
export function afterSignIn(next: string, onboardingStep: string | undefined): string {
  const slug = joinSlug(next);
  if (slug) return joinHref(slug);
  if (!next.startsWith("/admin") && onboardingStep !== "complete") return `/onboarding?returnTo=${encodeURIComponent(next)}`;
  return next;
}

const PROBE_ORIGIN = "https://events.invalid";
// Browsers strip tabs/newlines and treat "\\" as "/", so "/\t/evil.com" or "/\\evil.com" would leave the site.
const UNSAFE = /[\u0000-\u001f\u007f\s\\]/;

/**
 * Only same-origin paths are accepted as a post-sign-in destination (or a close/return link). Anything with control
 * characters, whitespace or a backslash is refused; the rest must resolve against a probe origin to that same origin.
 * Returns the normalized path + search + hash, else `fallback`.
 */
export function safeNext(next: string | null | undefined, fallback = "/me/events"): string {
  if (!next || !next.startsWith("/") || UNSAFE.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN || !url.pathname.startsWith("/")) return fallback;
  const out = url.pathname + url.search + url.hash;
  // Dot-segment normalisation can turn "/x/..//evil.com" into "//evil.com" (protocol-relative): re-check the output.
  if (out.startsWith("//") || out.startsWith("/\\") || UNSAFE.test(out)) return fallback;
  return out;
}
