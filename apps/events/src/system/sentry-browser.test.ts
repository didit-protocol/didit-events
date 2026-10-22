// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://events.didit.me/i/abc123?email=ana@example.com"}
import { getClient } from "@sentry/browser";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initBrowserSentry } from "./sentry-browser";

/** The real browser SDK as the lazy chunk builds it. `fetch` is stubbed: nothing leaves the machine. */
type Sent = { user?: unknown; release?: string; environment?: string; request?: { url?: string; headers?: Record<string, string> }; exception?: { values?: Array<{ value?: string }> }; sdk?: { settings?: { infer_ip?: string }; integrations?: string[] } };
const sent: Sent[] = [];
let capture: (error: unknown) => void;

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  capture = initBrowserSentry({ dsn: "https://public@o1.ingest.sentry.io/1", environment: "staging", release: "sha-test" });
  getClient()!.on("beforeEnvelope", envelope => {
    for (const [header, payload] of envelope[1]) if ((header as { type?: string }).type === "event") sent.push(payload as Sent);
  });
});

describe("the browser Sentry client", () => {
  it("sends an error with release and environment, a scrubbed page URL, no user and no IP inference", async () => {
    capture(new Error("could not save ana@example.com"));
    await getClient()!.flush(2000);
    expect(sent).toHaveLength(1);
    const event = sent[0]!;
    expect(event).toMatchObject({ release: "sha-test", environment: "staging" });
    expect(event.exception!.values!.at(-1)!.value).toBe("could not save <email>");
    expect(event.request?.url).toBe("https://events.didit.me/i/[token]");
    expect(event.user).toBeUndefined();
    expect(event.sdk?.settings?.infer_ip).toBe("never");
    expect(JSON.stringify(event)).not.toMatch(/example\.com|abc123/);
  });
  it("is errors only: no tracing, replay, feedback or session integrations", () => {
    const names = sent[0]!.sdk!.integrations!;
    expect(names.sort()).toEqual(["Breadcrumbs", "Dedupe", "EventFilters", "GlobalHandlers", "HttpContext", "LinkedErrors"]);
  });
  it("drops stale-deploy, aborted and interrupted-fetch errors", async () => {
    sent.length = 0;
    capture(Object.assign(new Error("Loading chunk 12 failed."), { name: "ChunkLoadError" }));
    capture(new DOMException("The user aborted a request.", "AbortError"));
    capture(new TypeError("Failed to fetch"));
    capture("ResizeObserver loop completed with undelivered notifications.");
    await getClient()!.flush(2000);
    expect(sent).toEqual([]);
  });
});
