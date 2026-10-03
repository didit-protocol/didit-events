/**
 * The last server errors of this process, for staff diagnosis through the MCP `system_status` tool (the app's logs are
 * not readable with the team's AWS roles). Only the route, error name, a short message, the digest and the time: no
 * request bodies, headers, cookies or emails (emails in messages are masked).
 */
export interface RecentError { at: string; path: string; method: string; name: string; message: string; digest?: string; kind?: string }
const MAX = 50;
// On globalThis: Next bundles instrumentation.ts apart from the route handlers, so a module array would not be shared.
const store = globalThis as typeof globalThis & { __diditRecentErrors?: RecentError[] };
const ring: RecentError[] = (store.__diditRecentErrors ??= []);
const redactPathTokens = (value: string) => value
  .replace(/(\/i\/)[^/?#\s]+/gi, "$1<token>")
  .replace(/(\/e\/[^/?#\s]+\/v\/)[^/?#\s]+/gi, "$1<token>")
  .replace(/\/[A-Za-z0-9_%=+.-]{24,}(?=[/?#\s]|$)/g, "/<token>");
const mask = (s: string) => redactPathTokens(s).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>").slice(0, 300);

export function recordServerError(error: unknown, request: { path?: string; method?: string }, context?: { routerKind?: string; routeType?: string }): void {
  const e = error as { name?: unknown; message?: unknown; digest?: unknown } | null;
  ring.push({
    at: new Date().toISOString(),
    path: mask(String(request.path ?? "").split(/[?#]/)[0]!).slice(0, 200),
    method: String(request.method ?? "").slice(0, 10),
    name: typeof e?.name === "string" ? e.name.slice(0, 80) : typeof error,
    message: mask(typeof e?.message === "string" ? e.message : String(error)),
    ...(typeof e?.digest === "string" ? { digest: e.digest.slice(0, 40) } : {}),
    ...(context?.routeType ? { kind: `${context.routerKind ?? ""}/${context.routeType}`.slice(0, 40) } : {}),
  });
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
}
export const recentServerErrors = (): RecentError[] => [...ring].reverse();
