/**
 * The avatar URL for a stored photo. The bytes live in `accounts.photo` (bytea) and are served by
 * GET /api/me/photo; the path never changes, so the account's `updated_at` is appended as a version to make a
 * new upload show up at once (the header, settings and profile re-render with a new `src`).
 */
export function photoSrc(url: string | null | undefined, version?: Date | string | number | null): string | undefined {
  if (!url) return undefined;
  const at = version == null ? NaN : new Date(version).getTime();
  return Number.isFinite(at) ? `${url}${url.includes("?") ? "&" : "?"}v=${at}` : url;
}
