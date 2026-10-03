import { AdmissionError } from "@didit-events/core/admission/shared";
import { PolicyError } from "@didit-events/core/http/policy";
import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { BROWSER_IGNORE_ERRORS, DATA_COLLECTION, IGNORE_ERRORS, isIgnoredError, scrubBreadcrumb, scrubEvent, scrubSpan, scrubText, sentryOptions } from "./sentry-scrub";
import { isStaleDeploy } from "./StaleDeploy";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"; // gitleaks:allow (synthetic sample token)
const event = (extra: Partial<ErrorEvent> = {}): ErrorEvent => ({ type: undefined, exception: { values: [{ type: "TypeError", value: "x is not a function" }] }, ...extra });

describe("scrubText", () => {
  it("masks emails", () => {
    expect(scrubText("no account for ana.perez+vip@example.co.uk (ana@didit.me)")).toBe("no account for <email> (<email>)");
  });
  it("removes token, code and session values from query strings and keeps the rest", () => {
    expect(scrubText("https://events.didit.me/api/auth/oidc/callback?code=abc123&state=xyz&next=/me"))
      .toBe("https://events.didit.me/api/auth/oidc/callback?code=[redacted]&state=[redacted]&next=/me");
    expect(scrubText("/e/summit/done?verificationSessionId=5b1f&status=Approved&csrf_token=t0k")).toBe("/e/summit/done?verificationSessionId=[redacted]&status=Approved&csrf_token=[redacted]");
    expect(scrubText("GET /events?page=2&q=barcelona")).toBe("GET /events?page=2&q=barcelona");
  });
  it("removes the bearer token of personal verification links and invites from paths", () => {
    expect(scrubText("https://events.didit.me/e/summit/v/9f8e7d6c5b4a?x=1")).toBe("https://events.didit.me/e/summit/v/[token]?x=1");
    expect(scrubText("GET /i/Zm9vYmFy-token failed")).toBe("GET /i/[token] failed");
    // The route pattern itself is left as it is.
    expect(scrubText("/i/[token]")).toBe("/i/[token]");
  });
  it("removes credentials wherever they appear", () => {
    expect(scrubText(`fetch failed with Authorization: Bearer ${JWT}`)).toBe("fetch failed with Authorization: Bearer [redacted]");
    expect(scrubText(`session ${JWT} rejected`)).toBe("session [jwt] rejected");
    expect(scrubText("Basic dXNlcjpwYXNz was refused")).toBe("Basic [redacted] was refused");
  });
});

describe("scrubEvent (beforeSend)", () => {
  it("drops cookies, the request body, the environment and every header that is not on the short list", () => {
    const out = scrubEvent(event({ request: {
      url: "https://events.didit.me/login?code=123456&next=/me", method: "POST", cookies: { "__Host-sid": "s3cr3t" }, data: { email: "ana@example.com", code: "123456" },
      env: { REMOTE_ADDR: "203.0.113.9" }, query_string: "code=123456&next=/me",
      headers: { Cookie: "__Host-sid=s3cr3t", authorization: `Bearer ${JWT}`, "x-forwarded-for": "203.0.113.9", "X-CSRF-Token": "t", "user-agent": "Mozilla/5.0", "content-type": "application/json" },
    } }))!;
    expect(out.request).toEqual({ url: "https://events.didit.me/login?code=[redacted]&next=/me", method: "POST", query_string: "code=[redacted]&next=/me",
      headers: { "user-agent": "Mozilla/5.0", "content-type": "application/json" } });
    expect(JSON.stringify(out)).not.toMatch(/s3cr3t|203\.0\.113\.9|example\.com|eyJ|123456/);
  });
  it("removes the user (id, email, IP address) whatever attached it", () => {
    const out = scrubEvent(event({ user: { id: "acc_1", email: "ana@example.com", ip_address: "203.0.113.9" } }))!;
    expect(out.user).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/example\.com|203\.0\.113\.9/);
  });
  it("masks emails and tokens in messages, breadcrumbs, tags, extra data and the Next request context", () => {
    const out = scrubEvent(event({
      message: "mail to ana@example.com bounced",
      exception: { values: [{ type: "Error", value: `no guest ana@example.com for /e/summit/v/9f8e7d6c (Bearer ${JWT})`, stacktrace: { frames: [{ filename: "app:///_next/server/app/i/[token]/page.js", function: "load" }] } }] },
      breadcrumbs: [{ category: "fetch", data: { url: "/api/me/profile?session_id=abc&tab=1", method: "GET" } }, { category: "navigation", data: { from: "/i/abc123", to: "/e/summit/v/tok987" } }],
      contexts: { nextjs: { request_path: "/i/abc123?email=ana@example.com", router_path: "/i/[token]" } },
      extra: { payload: { token: "raw-token", password: "hunter2", note: "call ana@example.com", nested: [["authorization", "Bearer abc"], ["page", "2"]] } },
      tags: { worker: "jobs", job: "identity:deletions" },
    }))!;
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/example\.com|9f8e7d6c|abc123|tok987|raw-token|hunter2|eyJ|Bearer abc/);
    expect(out.message).toBe("mail to <email> bounced");
    expect(out.exception!.values![0]!.value).toBe("no guest <email> for /e/summit/v/[token] (Bearer [redacted])");
    expect(out.breadcrumbs![0]!.data).toEqual({ url: "/api/me/profile?session_id=[redacted]&tab=1", method: "GET" });
    expect(out.breadcrumbs![1]!.data).toEqual({ from: "/i/[token]", to: "/e/summit/v/[token]" });
    expect(out.contexts!.nextjs).toEqual({ request_path: "/i/[token]?email=[redacted]", router_path: "/i/[token]" });
    expect(out.extra!.payload).toEqual({ token: "[redacted]", password: "[redacted]", note: "call <email>", nested: [["authorization", "[redacted]"], ["page", "2"]] });
    expect(out.tags).toEqual({ worker: "jobs", job: "identity:deletions" });
    // Stack frames are left alone so they still match the uploaded source maps.
    expect(out.exception!.values![0]!.stacktrace!.frames![0]!.filename).toBe("app:///_next/server/app/i/[token]/page.js");
  });
  it("drops 4xx domain errors and keeps 5xx and untyped ones", () => {
    expect(scrubEvent(event(), { originalException: new PolicyError(413, "BodyTooLarge") })).toBeNull();
    expect(scrubEvent(event(), { originalException: new AdmissionError("capacity") })).toBeNull();
    expect(scrubEvent(event(), { originalException: new PolicyError(500, "Broken") })).not.toBeNull();
    expect(scrubEvent(event(), { originalException: new TypeError("x is not a function") })).not.toBeNull();
  });
  it("drops expected noise: aborted requests, the ResizeObserver warning, stale deploys, Next control flow", () => {
    const noise = [
      Object.assign(new Error("The operation was aborted."), { name: "AbortError" }),
      new DOMException("signal is aborted without reason", "AbortError"),
      "ResizeObserver loop completed with undelivered notifications.",
      "ResizeObserver loop limit exceeded",
      new Error('Failed to find Server Action "40a2dd". This request might be from an older or newer deployment.'),
      Object.assign(new Error("Loading chunk 123 failed."), { name: "ChunkLoadError" }),
      new Error("Failed to load chunk /_next/static/chunks/abc.js"),
      new Error("NEXT_REDIRECT"),
    ];
    for (const error of noise) {
      expect(isIgnoredError(error), String(error)).toBe(true);
      expect(scrubEvent(event(), { originalException: error })).toBeNull();
    }
    // The same errors when only the serialized exception is available.
    expect(scrubEvent(event({ exception: { values: [{ type: "ChunkLoadError", value: "Loading chunk 9 failed." }] } }))).toBeNull();
    expect(scrubEvent(event({ exception: { values: [{ type: "AbortError", value: "The user aborted a request." }] } }))).toBeNull();
    expect(isIgnoredError(new Error("relation \"events\" does not exist"))).toBe(false);
  });
  it("ignores the same stale-deploy errors the error boundaries turn into a reload prompt", () => {
    for (const error of [new Error("This request might be from an older or newer deployment."), Object.assign(new Error("x"), { name: "ChunkLoadError" })]) {
      expect(isStaleDeploy(error)).toBe(true);
      expect(isIgnoredError(error)).toBe(true);
    }
  });
  it("treats a fetch cut short by the browser as noise in the browser only", () => {
    for (const message of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) {
      const error = new TypeError(message);
      expect(isIgnoredError(error, BROWSER_IGNORE_ERRORS)).toBe(true);
      expect(isIgnoredError(error, IGNORE_ERRORS)).toBe(false);
    }
    // Node's own fetch failure is a real server error.
    expect(isIgnoredError(new TypeError("fetch failed"), BROWSER_IGNORE_ERRORS)).toBe(false);
  });
});

describe("spans and breadcrumbs", () => {
  it("scrubs span names and attributes when tracing is turned on", () => {
    const out = scrubSpan({ name: "GET https://verification.didit.me/v3/session/abc/decision?api_key=k&x=1", span_id: "1", trace_id: "2",
      attributes: { "http.url": { type: "string", value: "https://events.didit.me/i/abc123" }, "http.request.header.cookie": { type: "string", value: "__Host-sid=s3cr3t" }, "url.full": "/login?code=1", "http.response.status_code": { type: "integer", value: 200 } } });
    expect(out).toEqual({ name: "GET https://verification.didit.me/v3/session/abc/decision?api_key=[redacted]&x=1", span_id: "1", trace_id: "2",
      attributes: { "http.url": { type: "string", value: "https://events.didit.me/i/[token]" }, "http.request.header.cookie": { type: "string", value: "[redacted]" }, "url.full": "/login?code=[redacted]", "http.response.status_code": { type: "integer", value: 200 } } });
  });
  it("scrubs breadcrumbs as they are recorded", () => {
    expect(scrubBreadcrumb({ category: "navigation", message: "to ana@example.com", data: { to: "/login?code=1" } })).toEqual({ category: "navigation", message: "to <email>", data: { to: "/login?code=[redacted]" } });
  });
});

describe("sentryOptions", () => {
  it("collects nothing personal: every dataCollection switch is off (SDK v11's replacement for sendDefaultPii: false)", () => {
    expect(DATA_COLLECTION).toEqual({
      userInfo: false, cookies: false, httpHeaders: { request: { allow: ["user-agent", "content-type", "accept-language"] }, response: false }, httpBodies: [], urlQueryParams: false,
      graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false }, databaseQueryData: false, queues: false, stackFrameVariables: false,
    });
  });
  it("sends errors only by default, with release and environment, scrubbed", () => {
    const options = sentryOptions({ dsn: "https://abc@o1.ingest.sentry.io/2", environment: "staging", release: "sha-1", tracesSampleRate: 0 });
    expect(options).toMatchObject({ dsn: "https://abc@o1.ingest.sentry.io/2", environment: "staging", release: "sha-1", dataCollection: DATA_COLLECTION, ignoreErrors: IGNORE_ERRORS });
    expect(options).not.toHaveProperty("tracesSampleRate");
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
    expect(options.beforeSendSpan).toBe(scrubSpan);
    expect(sentryOptions({ dsn: "https://abc@o1.ingest.sentry.io/2", environment: "production", tracesSampleRate: 0.1 })).toMatchObject({ tracesSampleRate: 0.1 });
    expect(sentryOptions({ dsn: "https://abc@o1.ingest.sentry.io/2", environment: "production" })).not.toHaveProperty("release");
  });
});
