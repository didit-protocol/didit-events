/**
 * A-01 sign-in: the `?error=` banners, the safe `next` target and the Didit OIDC start URL.
 *
 * `/api/auth/oidc/start` is built by lane B2 (Didit OIDC, PKCE S256, `idp=google`, `__Host-oidc` state cookie, C5).
 * Its callback redirects back here with `?error=domain` (not a @didit.me account), `?error=failed` (any other OIDC
 * failure) or `?error=expired` (a revoked or expired session).
 */
import type { BannerTone } from "@didit-events/ui";

export type LoginError = "domain" | "failed" | "expired";

export const LOGIN_COPY = {
  title: "Didit",
  titleAccent: "Events",
  lead: "Admin access is available to invited Didit staff.",
  help: "Having trouble? Ask whoever runs this site.",
  cta: "Continue with Google",
  pending: "Signing in…",
} as const;

export const LOGIN_BANNERS: Record<LoginError, { tone: BannerTone; text: string }> = {
  domain: { tone: "danger", text: "This account isn’t a Didit account. Use your @didit.me address." },
  failed: { tone: "danger", text: "Sign-in failed, try again." },
  expired: { tone: "info", text: "Your session expired. Sign in again to pick up where you left off." },
};

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export function parseLoginError(value: unknown): LoginError | undefined {
  const v = first(value);
  return v === "domain" || v === "failed" || v === "expired" ? v : undefined;
}

const PROBE_ORIGIN = "https://admin.invalid";
// Browsers strip tabs/newlines and treat "\\" as "/", so "/\t/evil.com" or "/\\evil.com" would leave the site.
const UNSAFE = /[\u0000-\u001f\u007f\s\\]/;
const ADMIN = /^\/admin(?:[/?#]|$)/;

/**
 * Only same-origin /admin paths may be a post-login target: the same rules as the accounts `safeNext` (no control
 * characters, whitespace or backslash; must resolve to the probe origin; re-checked after dot-segment normalisation)
 * plus the /admin prefix on the normalised path. Anything else is "/admin".
 */
export function safeNext(value: unknown): string {
  const v = first(value);
  if (typeof v !== "string" || !v.startsWith("/") || UNSAFE.test(v)) return "/admin";
  let url: URL;
  try {
    url = new URL(v, PROBE_ORIGIN);
  } catch {
    return "/admin";
  }
  if (url.origin !== PROBE_ORIGIN) return "/admin";
  const out = url.pathname + url.search + url.hash;
  // "/admin/..//evil.com" normalises to "//evil.com" (protocol-relative): re-check the output.
  if (out.startsWith("//") || UNSAFE.test(out) || !ADMIN.test(out)) return "/admin";
  return out;
}

export interface OidcStartOptions {
  /** "select_account" makes Google show the account picker (A-13b "Switch account"). */
  prompt?: "select_account";
}

/** The B2 route that starts Didit OIDC and redirects to Google. */
export function oidcStartUrl(next: string, opts: OidcStartOptions = {}): string {
  const q = new URLSearchParams({ as: "staff", next: safeNext(next) });
  if (opts.prompt) q.set("prompt", opts.prompt);
  return `/api/auth/oidc/start?${q.toString()}`;
}
