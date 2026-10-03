/**
 * Response security headers. Pure (no Node or Next imports): next.config.ts serves the static set on every response,
 * proxy.ts adds the per-request report-only policy with its nonce.
 *
 * Two policies on purpose:
 *   - enforced (`Content-Security-Policy`): the directives that cannot break a page (no plugins, no <base> hijack, forms
 *     post home, nobody frames us, no plain-HTTP subresources);
 *   - report-only (`Content-Security-Policy-Report-Only`): the full allowlist below, observed in the browser console
 *     until it is clean enough to enforce. No report endpoint yet.
 *
 * Every origin outside 'self', and the code it comes from:
 *   https://verify.didit.me           frame-src, form-action, camera. The hosted verification session: the Didit Web SDK
 *                                     puts it in an iframe with allow="camera; …" (src/accounts/join/sdk.ts), and three
 *                                     server actions redirect a form post to it (e/[slug]/v/[token], me/events/[slug]).
 *                                     The only host a session URL may have (core/verification/verification-service.ts).
 *   https://www.youtube-nocookie.com  frame-src. The one iframe an event description can carry (core/content/youtube.ts).
 *   https://maps.google.com           frame-src. The keyless venue map embed (src/public/map.ts), which Google serves
 *   https://www.google.com            after a redirect to www.google.com/maps. Its tiles load inside Google's frame.
 *   https://<org>.ingest.<region>.sentry.io
 *                                     connect-src. Browser error reports, from the origin of NEXT_PUBLIC_SENTRY_DSN
 *                                     (src/system/sentry-browser.ts); absent when the build has no DSN.
 *   EMAIL_ASSETS_URL, else APP_URL    font-src. The email preview (a srcdoc iframe, which inherits this policy) loads
 *                                     Inter from the email font origin (core/email/media.ts emailFontAssetsUrl). On
 *                                     localhost that is the app itself: nothing is loaded from the production site.
 *   https: (any host)                 img-src only. Event descriptions may show an image from any HTTPS URL
 *                                     (core/content/markdown.ts), and email previews load theirs the same way.
 * Not listed because the browser never calls them: the Didit API and OIDC endpoints, Google Places, Resend and
 * Firecrawl are server-side only; Google sign-in is a link, not a form. Covers, photos, fonts, the MediaPipe wasm and
 * model and the door worker are all same-origin.
 */

/** The hosted Didit verification session: the SDK iframe and the redirect target of the verification forms. */
export const DIDIT_VERIFY_ORIGIN = "https://verify.didit.me";
const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";
const GOOGLE_MAPS_EMBED_ORIGINS = ["https://maps.google.com", "https://www.google.com"];
/** APP_URL's origin: https, or http on this machine (a local instance runs on http://localhost). */
const webOrigin = (value: string | undefined | null): string | null => {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) ? url.origin : null;
  } catch {
    return null;
  }
};

const httpsOrigin = (value: string | undefined | null): string | null => {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

/** The origin browser error reports are sent to; null without a DSN. */
export const sentryIngestOrigin = (dsn: string | undefined | null): string | null => httpsOrigin(dsn);

/**
 * Camera for our own pages (door kiosk, profile photo) and the Didit verification frame, nothing else. Features that
 * are not named keep their default, which the embeds rely on (fullscreen, autoplay, encrypted-media, …). The SDK frame
 * also asks for microphone and geolocation: both stay off.
 */
export const PERMISSIONS_POLICY = [
  `camera=(self "${DIDIT_VERIFY_ORIGIN}")`,
  ...["microphone", "geolocation", "payment", "usb", "bluetooth", "serial", "hid", "midi", "magnetometer", "display-capture", "idle-detection", "browsing-topics"].map(feature => `${feature}=()`),
].join(", ");

export const HSTS = "max-age=63072000; includeSubDomains";

/**
 * The enforced policy. `upgrade-insecure-requests` is production only: WebKit applies it to http://localhost, which
 * would break `next dev` there.
 */
export function enforcedCsp(production: boolean): string {
  return [
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${DIDIT_VERIFY_ORIGIN}`,
    "frame-ancestors 'none'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * A response that is only ever an image: nothing in it may load or run, wherever it is opened. Served from
 * next.config.ts for the routes that use it, because a header set there replaces the route handler's own.
 */
export const IMAGE_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'";

/** Headers for every response (pages, API routes, assets). HSTS is production only; browsers ignore it over HTTP. */
export function securityHeaders(production: boolean): { key: string; value: string }[] {
  return [
    ...(production ? [{ key: "Strict-Transport-Security", value: HSTS }] : []),
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: enforcedCsp(production) },
  ];
}

export interface ReportOnlyOptions {
  production: boolean;
  sentryDsn?: string | null;
  /** EMAIL_ASSETS_URL, when the email assets are served from somewhere else: emails load their font from it. */
  emailAssetsUrl?: string | null;
  /** APP_URL: where emails load their font from when EMAIL_ASSETS_URL is unset. */
  appUrl?: string | null;
}

/**
 * The full policy, sent report-only. Scripts run by nonce: Next.js reads it from the request header proxy.ts sets and
 * stamps its own scripts; 'strict-dynamic' lets those load the chunks ('self' is the fallback for browsers without
 * it). 'wasm-unsafe-eval' is MediaPipe at the door. Inline styles stay allowed: React style attributes, the sanitized
 * description, the email preview and the <style> element the Didit SDK injects all need them.
 */
export function reportOnlyCsp(nonce: string, options: ReportOnlyOptions): string {
  const origins = (...values: (string | null)[]) => [...new Set(values.filter((value): value is string => !!value))].join(" ");
  return [
    "default-src 'self'",
    // `next dev` evaluates strings (React Refresh, source maps).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${options.production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `font-src ${origins("'self'", httpsOrigin(options.emailAssetsUrl) ?? webOrigin(options.appUrl))}`,
    `connect-src ${origins("'self'", sentryIngestOrigin(options.sentryDsn))}`,
    `frame-src ${origins(DIDIT_VERIFY_ORIGIN, YOUTUBE_EMBED_ORIGIN, ...GOOGLE_MAPS_EMBED_ORIGINS)}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${DIDIT_VERIFY_ORIGIN}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

/** 128 random bits, base64. Web Crypto, so it runs wherever the proxy does. */
export function cspNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/** The header Next.js reads the nonce from on the request, and the one the browser gets on the response. */
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

/** Documents only: API routes get the static set from next.config.ts and nothing else (so do build assets, which the proxy never sees). */
export const servesDocument = (path: string): boolean => !path.startsWith("/api/");
