import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { proxy } from "../../proxy";
import { cspNonce, enforcedCsp, reportOnlyCsp, securityHeaders, sentryIngestOrigin, servesDocument } from "./security-headers";

vi.mock("../auth/runtime", () => ({ identity: {} }));
afterEach(() => vi.unstubAllEnvs());

const ENFORCED = "object-src 'none'; base-uri 'self'; form-action 'self' https://verify.didit.me; frame-ancestors 'none'; upgrade-insecure-requests";
const PUBLIC_PAGE = "/e/ai-era-barcelona", ADMIN_PAGE = "/admin/events/ai-era-barcelona/guests", API_ROUTE = "/api/events/42/request";

/** What Next.js sends for a path: every matching `headers()` rule in order, a later rule replacing a header of the same name. */
async function configHeaders(path: string, env: "production" | "development" = "production"): Promise<Record<string, string>> {
  vi.stubEnv("NODE_ENV", env);
  const out: Record<string, string> = {};
  for (const rule of await nextConfig.headers!())
    if (getPathMatch(rule.source, { strict: true })(path)) for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
  return out;
}

/** Directive name → sources. Throws on what a browser would drop or misread: a repeated directive, a stray character. */
function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name || !/^[a-z-]+$/.test(name)) throw new Error(`bad directive name in "${part}"`);
    if (directives.has(name)) throw new Error(`directive ${name} repeated`);
    for (const source of sources)
      if (!/^(?:'(?:self|none|strict-dynamic|unsafe-inline|unsafe-eval|wasm-unsafe-eval|nonce-[A-Za-z0-9+/_-]+={0,2})'|(?:https|data|blob):|https:\/\/[a-z0-9.-]+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)$/.test(source)) throw new Error(`bad source ${source} in ${name}`);
    directives.set(name, sources);
  }
  return directives;
}

describe("enforced headers (next.config.ts)", () => {
  it.each([["a public page", PUBLIC_PAGE], ["an admin page", ADMIN_PAGE], ["an API route", API_ROUTE], ["the home page", "/"], ["a build asset", "/_next/static/chunks/main.js"], ["the door kiosk", "/admin/events/x/door/kiosk"]])("%s carries the whole set", async (_name, path) => {
    expect(await configHeaders(path)).toEqual({
      "strict-transport-security": "max-age=63072000; includeSubDomains",
      "x-content-type-options": "nosniff",
      "referrer-policy": path.startsWith("/api/") ? "no-referrer" : "strict-origin-when-cross-origin",
      "permissions-policy": 'camera=(self "https://verify.didit.me"), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), midi=(), magnetometer=(), display-capture=(), idle-detection=(), browsing-topics=()',
      "x-frame-options": "DENY",
      "content-security-policy": ENFORCED,
    });
  });

  it("keeps no-referrer on the links that carry a token, with the rest of the set", async () => {
    for (const path of ["/e/ai-era-barcelona/v/tok_123", "/e/ai-era-barcelona/done", "/i/tok_123", "/login", "/admin/login", "/me/deleting", "/onboarding", "/admin/events/test/door/exit"]) {
      const headers = await configHeaders(path);
      expect(headers["referrer-policy"]).toBe("no-referrer");
      expect(headers["cache-control"]).toBe("private, no-store");
      expect(headers["content-security-policy"]).toBe(ENFORCED);
      expect(headers["x-frame-options"]).toBe("DENY");
    }
  });

  it("restates what route handlers set themselves, because the config header replaces theirs", async () => {
    // Handlers with an explicit referrer policy have matching config rules.
    for (const path of [API_ROUTE, "/api/auth/oidc/start", "/api/auth/oidc/callback", "/api/me/verification/stream", "/api/admin/events/42/applicants/7/selfie", "/api/admin/events/42/editor", "/api/healthz", "/admin/events/test/door/exit"]) {
      const headers = await configHeaders(path);
      expect(headers["referrer-policy"], path).toBe("no-referrer");
      expect(headers["content-security-policy"], path).toBe(ENFORCED);
    }
    for (const kind of ["cover", "logo"]) {
      const headers = await configHeaders(`/api/calendar/${kind}`);
      expect(headers["content-security-policy"]).toBe("default-src 'none'; sandbox; frame-ancestors 'none'");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["x-content-type-options"]).toBe("nosniff");
    }
    // Each handler setting one of these headers must also be covered in next.config.ts.
    const app = fileURLToPath(new URL("../../", import.meta.url));
    const own = globSync("{app,src}/**/*.{ts,tsx}", { cwd: app })
      .filter(file => !/\.test\.tsx?$/.test(file) && !file.endsWith("system/security-headers.ts"))
      .filter(file => /["'](?:referrer-policy|content-security-policy|x-frame-options|permissions-policy|strict-transport-security)["']/i.test(readFileSync(join(app, file), "utf8")));
    expect(own.sort()).toEqual(["app/admin/(door)/events/[id]/door/exit/route.ts", "app/api/auth/oidc/callback/route.ts", "app/api/auth/oidc/start/route.ts", "app/api/calendar/[kind]/route.ts", "src/server/event-model-api.ts", "src/server/verification-stream.ts"]);
  });

  it("leaves ordinary page, API and asset caching unchanged, and HSTS has no preload", async () => {
    for (const path of [PUBLIC_PAGE, ADMIN_PAGE, API_ROUTE, "/_next/static/chunks/main.js"]) expect(await configHeaders(path)).not.toHaveProperty("cache-control");
    expect((await configHeaders(PUBLIC_PAGE))["strict-transport-security"]).not.toContain("preload");
  });

  it("leaves HSTS and upgrade-insecure-requests out of `next dev`, where the site is plain HTTP", async () => {
    const headers = await configHeaders(PUBLIC_PAGE, "development");
    expect(headers).not.toHaveProperty("strict-transport-security");
    expect(headers["content-security-policy"]).toBe("object-src 'none'; base-uri 'self'; form-action 'self' https://verify.didit.me; frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(securityHeaders(false).map(header => header.key)).toEqual(securityHeaders(true).map(header => header.key).filter(key => key !== "Strict-Transport-Security"));
  });

  it("parses, and allows nothing but our own origin and the Didit verification form target", () => {
    const csp = parseCsp(enforcedCsp(true));
    expect(Object.fromEntries(csp)).toEqual({ "object-src": ["'none'"], "base-uri": ["'self'"], "form-action": ["'self'", "https://verify.didit.me"], "frame-ancestors": ["'none'"], "upgrade-insecure-requests": [] });
    // Nothing here can block a script, a style or a request: that is what the report-only policy is for.
    for (const name of ["default-src", "script-src", "style-src", "connect-src", "img-src", "frame-src"]) expect(csp.has(name)).toBe(false);
  });
});

describe("report-only policy (proxy.ts)", () => {
  const dsn = "https://0123456789abcdef0123456789abcdef@o1234567890123456.ingest.us.sentry.io/1234567890123456";

  it("parses, with every origin accounted for", () => {
    const csp = parseCsp(reportOnlyCsp("bm9uY2Vub25jZW5vbmNlbg==", { production: true, sentryDsn: dsn }));
    expect(Object.fromEntries(csp)).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'", "'nonce-bm9uY2Vub25jZW5vbmNlbg=='", "'strict-dynamic'", "'wasm-unsafe-eval'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:", "https:"],
      "font-src": ["'self'"],
      "connect-src": ["'self'", "https://o1234567890123456.ingest.us.sentry.io"],
      "frame-src": ["https://verify.didit.me", "https://www.youtube-nocookie.com", "https://maps.google.com", "https://www.google.com"],
      "worker-src": ["'self'", "blob:"],
      "media-src": ["'self'", "blob:"],
      "manifest-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'", "https://verify.didit.me"],
      "frame-ancestors": ["'none'"],
    });
    // Scripts never run from an inline handler, a string or a whole scheme; only images may come from any HTTPS host.
    expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
    expect(csp.get("script-src")).not.toContain("'unsafe-eval'");
    for (const [name, sources] of csp) if (name !== "img-src") expect(sources).not.toContain("https:");
  });

  it("adds only what the environment asks for", () => {
    const bare = parseCsp(reportOnlyCsp("abc", { production: true }));
    expect(bare.get("connect-src")).toEqual(["'self'"]);
    expect(parseCsp(reportOnlyCsp("abc", { production: true, sentryDsn: "" })).get("connect-src")).toEqual(["'self'"]);
    expect(parseCsp(reportOnlyCsp("abc", { production: true, sentryDsn: "not a url; script-src *" })).get("connect-src")).toEqual(["'self'"]);
    expect(parseCsp(reportOnlyCsp("abc", { production: true, emailAssetsUrl: "https://assets.didit.me/email/" })).get("font-src")).toEqual(["'self'", "https://assets.didit.me"]);
    // The email font comes from EMAIL_ASSETS_URL, else APP_URL: a local instance never allows (or loads from) the production site.
    expect(parseCsp(reportOnlyCsp("abc", { production: true, emailAssetsUrl: "https://assets.didit.me", appUrl: "https://events.example.org" })).get("font-src")).toEqual(["'self'", "https://assets.didit.me"]);
    expect(parseCsp(reportOnlyCsp("abc", { production: true, appUrl: "https://events.example.org/" })).get("font-src")).toEqual(["'self'", "https://events.example.org"]);
    expect(parseCsp(reportOnlyCsp("abc", { production: false, appUrl: "http://localhost:3332" })).get("font-src")).toEqual(["'self'", "http://localhost:3332"]);
    expect(parseCsp(reportOnlyCsp("abc", { production: true, emailAssetsUrl: "http://localhost:3332" })).get("font-src")).toEqual(["'self'"]);
    expect(parseCsp(reportOnlyCsp("abc", { production: true, appUrl: "javascript:alert(1); script-src *" })).get("font-src")).toEqual(["'self'"]);
    expect(parseCsp(reportOnlyCsp("abc", { production: true, appUrl: "http://events.example.org" })).get("font-src")).toEqual(["'self'"]);
    for (const options of [{}, { appUrl: "http://localhost:3332" }, { appUrl: "https://events.example.org" }]) expect(reportOnlyCsp("abc", { production: true, ...options })).not.toContain("events.didit.me");
    expect(parseCsp(reportOnlyCsp("abc", { production: false })).get("script-src")).toContain("'unsafe-eval'");
    expect(sentryIngestOrigin(dsn)).toBe("https://o1234567890123456.ingest.us.sentry.io");
    expect(sentryIngestOrigin(dsn)).not.toContain("0123456789abcdef");
  });

  it("makes a fresh nonce Next.js accepts", () => {
    const nonces = new Set(Array.from({ length: 200 }, cspNonce));
    expect(nonces.size).toBe(200);
    // The pattern Next.js reads a nonce with (server/app-render/get-script-nonce-from-header).
    for (const nonce of nonces) expect(`'nonce-${nonce}'`).toMatch(/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/);
    expect(atob([...nonces][0]!)).toHaveLength(16);
  });

  it.each([["a public page", PUBLIC_PAGE], ["an admin page", ADMIN_PAGE], ["a form post", PUBLIC_PAGE]])("gives %s the policy on the response and the same nonce on the request", async (name, path) => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
    const response = await proxy(new NextRequest(`https://events.test${path}`, { method: name === "a form post" ? "POST" : "GET" }));
    const policy = response.headers.get("content-security-policy-report-only")!;
    expect(parseCsp(policy).get("connect-src")).toEqual(["'self'", "https://o1234567890123456.ingest.us.sentry.io"]);
    // NextResponse.next forwards request headers to the render under this prefix.
    expect(response.headers.get("x-middleware-request-content-security-policy-report-only")).toBe(policy);
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("cache-control")).toBeNull();
    const again = await proxy(new NextRequest(`https://events.test${path}`));
    expect(again.headers.get("content-security-policy-report-only")).not.toBe(policy);
  });

  it("leaves API routes to the static set", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    for (const path of [API_ROUTE, "/api/healthz", "/api/auth/oidc/start", "/api/admin/events/42/stream"]) {
      const response = await proxy(new NextRequest(`https://events.test${path}`));
      expect(response.headers.get("content-security-policy-report-only"), path).toBeNull();
      expect(response.headers.get("x-middleware-request-content-security-policy-report-only"), path).toBeNull();
      expect(servesDocument(path)).toBe(false);
    }
    for (const path of ["/", PUBLIC_PAGE, ADMIN_PAGE, "/apiary", "/login"]) expect(servesDocument(path)).toBe(true);
  });
});
