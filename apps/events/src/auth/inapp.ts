/**
 * In-app browsers (the webview an app opens for a tapped link). Google refuses OAuth inside embedded webviews
 * (disallowed_useragent) and many of them hand accounts.google.com to Safari or the Google app, so the return lands in
 * a browser without the Didit auth session and the sign-in fails there. The email code works in any of them.
 *
 * Pure (no Node or Next imports): the client components import its types, the server derives the flag from the
 * User-Agent header.
 */
export type InAppName = "X" | "LinkedIn" | "Instagram" | "Facebook" | "TikTok" | "Threads" | "Snapchat" | "Line" | "WeChat" | "Telegram" | "Gmail" | "other";
export type InAppOs = "ios" | "android" | "other";

/** What a sign-in surface needs to guide a guest out of an in-app browser. */
export interface InAppInfo {
  app: InAppName;
  os: InAppOs;
  /** This page as a same-origin path (keeps ?join=1 / next): what "Copy link" copies. */
  path: string;
  /** "Open in browser" target, or null when the page's origin is unknown (the copy link and the hint remain). */
  openHref: string | null;
}

// Threads sits before Instagram and Instagram before Facebook: Meta's apps share tokens.
const APPS: readonly (readonly [InAppName, RegExp])[] = [
  ["Threads", /\bBarcelona\b/],
  ["Instagram", /\bInstagram\b/],
  ["Facebook", /FBAN|FBAV|FB_IAB|FBIOS/],
  ["X", /Twitter/],
  ["LinkedIn", /LinkedInApp/],
  ["TikTok", /musical_ly|BytedanceWebview|TikTok/],
  ["Snapchat", /Snapchat/],
  ["Line", /\bLine\//],
  ["WeChat", /MicroMessenger/],
  ["Telegram", /Telegram/],
  ["Gmail", /\bGmail\b/],
];

/** The app whose in-app browser sent this User-Agent, "other" for an unnamed webview, null for a real browser. */
export function inAppBrowser(ua: string | null | undefined): null | { app: InAppName } {
  if (!ua) return null;
  const s = ua.slice(0, 1024);
  for (const [app, pattern] of APPS) if (pattern.test(s)) return { app };
  // The Google app (GSA) is a webview Google itself allows.
  if (/\bGSA\//.test(s)) return null;
  // Android System WebView marks itself with "; wv)". On iOS every real browser (Safari, CriOS, FxiOS, EdgiOS) keeps
  // the "Safari/" token and a bare WKWebView does not.
  if (/Android/.test(s) && /; wv\)/.test(s)) return { app: "other" };
  if (/\b(?:iPhone|iPad|iPod)\b/.test(s) && /AppleWebKit/.test(s) && !/Safari\//.test(s)) return { app: "other" };
  return null;
}

export function inAppOs(ua: string | null | undefined): InAppOs {
  const s = (ua ?? "").slice(0, 1024);
  return /Android/.test(s) ? "android" : /\b(?:iPhone|iPad|iPod)\b/.test(s) ? "ios" : "other";
}

/** `target` (a path or an absolute URL) as a URL of `origin`; null for anything that resolves to another host. */
function sameOrigin(target: string, origin: string): URL | null {
  try {
    const base = new URL(origin), url = new URL(target, base);
    if (url.origin !== base.origin || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
    return url;
  } catch {
    return null;
  }
}

/** Android: an intent that opens the page in Chrome; without Chrome the intent falls back to the plain URL. */
export function androidIntentUrl(target: string, origin: string): string | null {
  const url = sameOrigin(target, origin);
  if (!url) return null;
  const plain = `${url.origin}${url.pathname}${url.search}`;
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(plain)};end`;
}

/** iOS: Safari's own scheme (`x-safari-https://host/path`). */
export function safariUrl(target: string, origin: string): string | null {
  const url = sameOrigin(target, origin);
  return url ? `x-safari-${url.protocol.slice(0, -1)}://${url.host}${url.pathname}${url.search}` : null;
}

/** The "Open in browser" target for this OS; elsewhere the plain URL (opened in a new window). */
export function openInBrowserUrl(os: InAppOs, target: string, origin: string): string | null {
  if (os === "android") return androidIntentUrl(target, origin);
  if (os === "ios") return safariUrl(target, origin);
  const url = sameOrigin(target, origin);
  return url ? `${url.origin}${url.pathname}${url.search}` : null;
}

/** The flag every sign-in surface gets: null in a real browser. `path` is the page the guest is on. */
export function inAppInfo(ua: string | null | undefined, origin: string | null, path: string): InAppInfo | null {
  const found = inAppBrowser(ua);
  if (!found) return null;
  const os = inAppOs(ua);
  return { app: found.app, os, path, openHref: origin ? openInBrowserUrl(os, path, origin) : null };
}
