import { PolicyError } from "@didit-events/core/http/policy";
import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initServerSentry } from "./sentry-server";

/**
 * The real SDK, not a mock: what the client is about to send is read from its `beforeEnvelope` hook. The DSN points at a
 * closed local port, so nothing leaves the machine.
 */
type Sent = { user?: unknown; release?: string; environment?: string; tags?: Record<string, string>; request?: { headers?: Record<string, string>; cookies?: unknown; data?: unknown }; contexts?: Record<string, Record<string, unknown>>;
  exception?: { values?: Array<{ type?: string; value?: string }> } };
const sent: Sent[] = [];

beforeAll(() => {
  expect(initServerSentry({ SENTRY_DSN: "http://public@127.0.0.1:9/1", DIDIT_ENV: "staging", SENTRY_RELEASE: "sha-test" })).toBe(true);
  Sentry.getClient()!.on("beforeEnvelope", envelope => {
    for (const [header, payload] of envelope[1]) if ((header as { type?: string }).type === "event") sent.push(payload as Sent);
  });
});
afterAll(async () => { await Sentry.close(500); });

describe("the Sentry SDK as configured", () => {
  it("sends a request error with release and environment and without anything personal", async () => {
    sent.length = 0;
    Sentry.captureRequestError(new Error("no guest ana@example.com at /e/summit/v/9f8e7d6c"),
      { path: "/i/abc123?email=ana@example.com", method: "POST", headers: { cookie: "__Host-sid=s3cr3t", authorization: "Bearer abc.def", "x-forwarded-for": "203.0.113.9", "user-agent": "Mozilla/5.0" } },
      { routerKind: "App Router", routePath: "/i/[token]", routeType: "action" });
    await Sentry.flush(2000);
    expect(sent).toHaveLength(1);
    const event = sent[0]!;
    expect(event).toMatchObject({ release: "sha-test", environment: "staging" });
    expect(event.exception!.values!.at(-1)).toMatchObject({ type: "Error", value: "no guest <email> at /e/summit/v/[token]" });
    expect(event.contexts!.nextjs).toMatchObject({ request_path: "/i/[token]", router_path: "/i/[token]", route_type: "action" });
    expect(event.user).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(Object.keys(event.request?.headers ?? {}).filter(name => name.toLowerCase() !== "user-agent")).toEqual([]);
    // Stack frames carry source lines (here: this test file), never runtime values, and no local variables.
    expect(JSON.stringify(event.exception)).not.toContain('"vars"');
    expect(JSON.stringify(event, (key, value: unknown) => key === "stacktrace" ? undefined : value)).not.toMatch(/example\.com|s3cr3t|203\.0\.113\.9|abc\.def|abc123|9f8e7d6c/);
  });
  it("sends nothing for a 4xx domain error, an aborted request or a stale deploy", async () => {
    sent.length = 0;
    const context = { routerKind: "App Router", routePath: "/api/x", routeType: "route" };
    for (const error of [new PolicyError(413, "BodyTooLarge"), Object.assign(new Error("The operation was aborted."), { name: "AbortError" }), new Error("Failed to find Server Action \"ab\". This request might be from an older or newer deployment.")]) {
      Sentry.captureRequestError(error, { path: "/api/x", method: "POST", headers: {} }, context);
    }
    await Sentry.flush(2000);
    expect(sent).toEqual([]);
  });
});
