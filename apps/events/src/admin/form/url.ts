/** Full event description limit (events.description_md). */
export const DESCRIPTION_MD_MAX = 20_000;

/** A link or image target the editor accepts: HTTPS, parsable, no credentials. Returns the normalized URL. */
export function safeHttpsUrl(raw: string): string | null {
  const s = raw.trim();
  if (!/^https:\/\//i.test(s) || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}
