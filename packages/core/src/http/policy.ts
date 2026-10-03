import { timingSafeEqual } from "node:crypto";
import type { Db } from "../db/index.ts";
import { store } from "../inbox.ts";
import { verifyWebhookSignature } from "../webhook/signature.ts";

export class PolicyError extends Error {
  readonly status: number;
  constructor(status: number, code: string) { super(code); this.name = "PolicyError"; this.status = status; }
}
export const BODY_LIMITS = { webhook: 1024 * 1024, scan: 400 * 1024, default: 64 * 1024 } as const;
/** Reads incrementally and stops at the cap, including chunked bodies with no Content-Length. */
export async function bodyLimit(req: Request, maxBytes = BODY_LIMITS.default, contentType?: string): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("InvalidBodyLimit");
  if (contentType && req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== contentType) throw new PolicyError(415, "UnsupportedMediaType");
  const length = req.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new PolicyError(413, "BodyTooLarge");
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new PolicyError(413, "BodyTooLarge"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export const COOKIE_NAMES = { session: "__Host-sid", csrf: "__Host-csrf", oidc: "__Host-oidc", otp: "__Host-otp", anonymous: "__Host-anon", door: "__Host-door", reauth: "__Host-reauth" } as const;
export function cookieAttributes(name: typeof COOKIE_NAMES[keyof typeof COOKIE_NAMES], maxAge: number) {
  return { secure: true as const, httpOnly: name !== COOKIE_NAMES.csrf, sameSite: "lax" as const, path: "/" as const, maxAge };
}
export function serializeCookie(name: typeof COOKIE_NAMES[keyof typeof COOKIE_NAMES], value: string, maxAge: number): string {
  if (!Object.values(COOKIE_NAMES).includes(name) || !Number.isSafeInteger(maxAge) || maxAge < 0) throw new Error("InvalidCookie");
  return `${name}=${encodeURIComponent(value)}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}${name === COOKIE_NAMES.csrf ? "" : "; HttpOnly"}`;
}
export function requestCookies(req: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (result.has(name)) throw new PolicyError(403, "DuplicateCookie");
    try { result.set(name, decodeURIComponent(part.slice(i + 1).trim())); } catch { throw new PolicyError(403, "InvalidCookie"); }
  }
  return result;
}
const equal = (a: string, b: string): boolean => a.length > 0 && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export interface BrowserPolicyOptions { origins: readonly string[]; maxBytes?: number; contentType?: string; allowAnonymous?: boolean }
/** Guard for route handlers and actions adapted to Request. AuthService still validates the signed session/principal. */
export async function browserMutation(req: Request, options: BrowserPolicyOptions): Promise<{ sessionCookie: string; body: Uint8Array }> {
  const origin = req.headers.get("origin");
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !origin || !options.origins.includes(origin) || origin === "null" || req.headers.has("authorization") || req.headers.has("x-signature-v2") || req.headers.has("x-signature")) throw new PolicyError(403, "BrowserOriginRequired");
  const jar = requestCookies(req), csrf = jar.get(COOKIE_NAMES.csrf), header = req.headers.get("x-csrf"), session = jar.get(COOKIE_NAMES.session) ?? (options.allowAnonymous ? jar.get(COOKIE_NAMES.anonymous) : undefined);
  if (!csrf || !header || !equal(csrf, header) || !session) throw new PolicyError(403, "BrowserSessionAndCsrfRequired");
  return { sessionCookie: session, body: await bodyLimit(req, options.maxBytes, options.contentType) };
}
/** Durable inbox write is part of authentication, before the route acknowledges. */
export async function webhookAuth(req: Request, secret: string, options: { db?: Db; now?: Date } = {}): Promise<{ id: string; duplicate: boolean }> {
  if (req.method !== "POST" || ["cookie", "authorization", "origin", "x-csrf"].some(header => req.headers.has(header))) throw new PolicyError(401, "WebhookCallerRequired");
  const bytes = await bodyLimit(req, BODY_LIMITS.webhook, "application/json");
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new PolicyError(400, "InvalidWebhookEncoding"); }
  if (!verifyWebhookSignature(raw, req.headers, secret, options.now)) throw new PolicyError(401, "InvalidWebhookSignature");
  return store(raw, req.headers, options.db);
}
