// Where email images come from. Mail is read on Gmail/Outlook servers, so every image must be an absolute HTTPS URL
// those servers can fetch: a local instance (APP_URL=http://localhost:3332) still sends a working logo and hero.
//   static assets (logo, icons, font, theme art): EMAIL_ASSETS_URL, else APP_URL when it is a public https origin,
//                                                 else the production site
//   the web font (Inter):                         EMAIL_ASSETS_URL, else APP_URL as it is (a local instance loads its
//                                                 own copy; mail clients that cannot reach it use the system font)
//   event images (cover, banner, photos):         APP_URL only when it is a public https origin, else the static
//                                                 theme art on the asset base (people fall back to initials)

/** Production origin: hosts `/email` and `/email-icons` (apps/events/public). */
export const DEFAULT_EMAIL_ASSETS_ORIGIN = "https://events.didit.me";

export type CoverTheme = "aqua" | "sky";

const trim = (u: string) => u.replace(/\/+$/, "");

/** True for an https origin a mail provider can reach: not localhost, loopback, link-local or a private range. */
export function isPublicHttpsOrigin(url: string | undefined | null): boolean {
  let u: URL;
  try {
    u = new URL(url ?? "");
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "::1" || host === "::" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return false;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  return true;
}

/** The origin static email assets are served from (EMAIL_ASSETS_URL → public APP_URL → production). */
export function emailAssetsOrigin(appUrl: string, configured?: string | null): string {
  if (configured != null) {
    if (!isPublicHttpsOrigin(configured)) throw new Error("EMAIL_ASSETS_URL must be a public https origin");
    return trim(configured);
  }
  if (isPublicHttpsOrigin(appUrl)) return trim(new URL(appUrl).origin);
  return DEFAULT_EMAIL_ASSETS_ORIGIN;
}

/** The `/email` asset folder templates read (`EmailBase.assetsUrl`); icons sit beside it in `/email-icons`. */
export const emailAssetsUrl = (appUrl: string, configured?: string | null) => `${emailAssetsOrigin(appUrl, configured)}/email`;

/**
 * The `/email` folder the web font is read from (`EmailBase.fontAssetsUrl`): EMAIL_ASSETS_URL, else APP_URL itself, even
 * when it is not public. A font that does not load only means the system font, so a local instance (and its email
 * preview) never reaches for the production site.
 */
export function emailFontAssetsUrl(appUrl: string, configured?: string | null): string {
  if (configured != null) return emailAssetsUrl(appUrl, configured);
  try {
    return `${new URL(appUrl).origin}/email`;
  } catch {
    return emailAssetsUrl(appUrl);
  }
}

/** Static generated theme art (1200×630 JPG, apps/events/public/email/cover-<theme>.jpg): the hero when no event image can load. */
export const themeArtUrl = (assetsUrl: string, theme: CoverTheme = "aqua") => `${trim(assetsUrl)}/cover-${theme}.jpg`;

/**
 * An event image for an email: the app path on APP_URL when that origin is public, else the theme art. Absolute
 * https URLs on a public host pass through; anything else (relative, http, localhost) never reaches an inbox.
 */
export function eventImageUrl(pathOrUrl: string, appUrl: string, assetsUrl: string, theme?: CoverTheme): string {
  if (/^https:\/\//i.test(pathOrUrl)) return isPublicHttpsOrigin(pathOrUrl) ? pathOrUrl : themeArtUrl(assetsUrl, theme);
  if (pathOrUrl.startsWith("/") && !pathOrUrl.startsWith("//") && isPublicHttpsOrigin(appUrl)) return `${trim(appUrl)}${pathOrUrl}`;
  return themeArtUrl(assetsUrl, theme);
}

/** A person photo for an email: kept only when it is publicly reachable; `null` shows initials. */
export function personPhotoUrl(url: string | null | undefined, appUrl: string): string | null {
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return isPublicHttpsOrigin(url) ? url : null;
  if (url.startsWith("/") && !url.startsWith("//") && isPublicHttpsOrigin(appUrl)) return `${trim(appUrl)}${url}`;
  return null;
}
