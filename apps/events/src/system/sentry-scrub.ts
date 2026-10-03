import { isExpectedError } from "@didit-events/core/error-reporting";
import type { Breadcrumb, ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * What leaves for Sentry, shared by the server, edge and browser clients. Didit Events is an identity product: an event
 * carries the error, its stack, the route and the release, and nothing about the person. Two layers: `DATA_COLLECTION`
 * stops the SDK from collecting, and `scrubEvent` (beforeSend) removes whatever still got in.
 */

/** SDK v11 replaced `sendDefaultPii` with `dataCollection`, whose defaults collect everything: turn each one off. */
export const KEPT_HEADERS = ["user-agent", "content-type", "accept-language"];
export const DATA_COLLECTION = {
  userInfo: false, // No user fields and no IP address (`infer_ip: never`).
  cookies: false,
  httpHeaders: { request: { allow: KEPT_HEADERS }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

/** The same test as src/system/StaleDeploy.tsx: a page of the previous build calling the new one is not a defect. */
export const STALE_DEPLOY = /Failed to find Server Action|older or newer deployment|ChunkLoadError|Loading chunk [\w-]+ failed|Failed to load chunk/i;
/** Expected noise on every runtime: stale deploys, aborted requests, the benign ResizeObserver warning, Next control flow. */
export const IGNORE_ERRORS: RegExp[] = [
  STALE_DEPLOY,
  /AbortError|The operation was aborted|signal is aborted|The user aborted a request|Fetch is aborted|Request aborted/i,
  /ResizeObserver loop/i,
  /NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK/,
];
/** Browsers report a fetch cut short by navigation, sleep or a lost connection with these messages. */
export const BROWSER_IGNORE_ERRORS: RegExp[] = [...IGNORE_ERRORS, /^(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource|cancelled)/i];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SECRET_NAME = "token|code|session|secret|signature|sig|key|state|email|otp|password|auth";
const SECRET_PARAM = new RegExp(`([?&;][^=&#\\s]*(?:${SECRET_NAME})[^=&#\\s]*=)[^&#\\s"'<>]*`, "gi");
// Personal verification links (/e/:slug/v/:token) and direct invites (/i/:token) carry a bearer token in the path.
const PATH_TOKEN = /(\/e\/[^/?#\s]+\/v\/|\/i\/)[^/?#\s"'<>)]+/g;
const CREDENTIAL = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const SECRET_KEY = /token|secret|passw|authorization|cookie|session|otp|api[-_]?key|signature|email|^code$/i;
// Not free text: stack frames must still match their source maps, and these values are set by the app or the SDK.
const UNTOUCHED = new Set(["stacktrace", "sdk", "debug_meta", "event_id", "release", "environment", "platform", "timestamp", "start_timestamp"]);

/** Emails masked; credentials, tokens in paths and sensitive query values removed. Works on any text, URLs included. */
export function scrubText(text: string): string {
  return text.replace(CREDENTIAL, "$1 [redacted]").replace(JWT, "[jwt]").replace(SECRET_PARAM, "$1[redacted]").replace(PATH_TOKEN, "$1[token]").replace(EMAIL, "<email>");
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object" || depth > 10) return value;
  if (Array.isArray(value)) {
    // A [name, value] pair (query strings, header lists).
    if (value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string" && SECRET_KEY.test(value[0])) return [value[0], "[redacted]"];
    return value.map(item => scrubValue(item, depth + 1));
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (UNTOUCHED.has(key)) continue;
    const item = record[key];
    if (!SECRET_KEY.test(key)) record[key] = scrubValue(item, depth + 1);
    else if (typeof item === "string") record[key] = "[redacted]";
    // A typed span attribute: { type, value }.
    else if (item !== null && typeof item === "object" && typeof (item as { value?: unknown }).value === "string") (item as { value: string }).value = "[redacted]";
    else record[key] = scrubValue(item, depth + 1);
  }
  return record;
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error === null || typeof error !== "object") return "";
  const { name, message } = error as { name?: unknown; message?: unknown };
  return `${typeof name === "string" ? name : "Error"}: ${typeof message === "string" ? message : ""}`;
}

export function isIgnoredError(error: unknown, patterns: RegExp[] = IGNORE_ERRORS): boolean {
  const text = messageOf(error);
  return text !== "" && patterns.some(pattern => pattern.test(text));
}

function scrubPayload(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  if (request) {
    delete request.cookies;
    delete request.data;
    delete request.env;
    if (request.headers) request.headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => KEPT_HEADERS.includes(name.toLowerCase())));
    if (typeof request.query_string === "string") request.query_string = scrubText(`?${request.query_string.replace(/^\?/, "")}`).slice(1);
  }
  // The app never sets a user; this drops any id, email or IP address an integration attached.
  delete event.user;
  scrubValue(event, 0);
  return event;
}

/** beforeSend: drops domain 4xx errors and expected noise, then strips personal data from what is left. */
export function scrubEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent | null {
  const original = hint?.originalException;
  if (isExpectedError(original) || isIgnoredError(original)) return null;
  const last = event.exception?.values?.at(-1);
  if (last && isIgnoredError({ name: last.type, message: last.value })) return null;
  return scrubPayload(event);
}

/**
 * beforeSendSpan: only reached when SENTRY_TRACES_SAMPLE_RATE is above 0. SDK v11 streams spans one by one (it ignores
 * beforeSendTransaction), so span names and attributes (URLs, queries) are scrubbed here.
 */
export function scrubSpan<T extends object>(span: T): T {
  return scrubValue(span, 0) as T;
}

/** beforeBreadcrumb: navigation and request URLs are kept without tokens, query secrets or emails. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  return scrubValue(breadcrumb, 0) as Breadcrumb;
}

/** Options every runtime shares. `tracesSampleRate` is left out at 0 so the SDK does no tracing work at all. */
export function sentryOptions(env: { dsn: string; environment: string; release?: string; tracesSampleRate?: number }) {
  return {
    dsn: env.dsn,
    environment: env.environment,
    ...(env.release ? { release: env.release } : {}),
    ...(env.tracesSampleRate ? { tracesSampleRate: env.tracesSampleRate } : {}),
    dataCollection: DATA_COLLECTION,
    ignoreErrors: IGNORE_ERRORS,
    beforeSend: scrubEvent,
    beforeSendSpan: scrubSpan,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
