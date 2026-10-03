// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://events.example.test"}
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ActionCsrf } from "./ActionCsrf";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

it("adds the current CSRF token only to same-origin actions and preserves the request", async () => {
  const fetch = vi.fn(async (_request: Request) => new Response("ok")); vi.stubGlobal("fetch", fetch);
  const host = document.createElement("div"), root = createRoot(host);
  document.cookie = "__Host-csrf=first; Secure; Path=/";
  act(() => root.render(<ActionCsrf />));
  try {
    const signal = new AbortController().signal;
    await window.fetch("/admin", { method: "POST", headers: { "next-action": "action-id" }, body: "test body", credentials: "include", signal });
    const sent = fetch.mock.calls[0]![0] as unknown as Request;
    expect(sent.url).toBe("https://events.example.test/admin");
    expect(sent.method).toBe("POST"); expect(sent.credentials).toBe("include");
    expect(await sent.text()).toBe("test body"); expect(sent.headers.get("x-csrf")).toBe("first");
    document.cookie = "__Host-csrf=second; Secure; Path=/";
    await window.fetch(new Request("https://events.example.test/admin", { method: "POST", headers: { "next-action": "action-id" } }));
    expect((fetch.mock.calls[1]![0] as unknown as Request).headers.get("x-csrf")).toBe("second");
    await window.fetch("https://other.example.test", { method: "POST", headers: { "next-action": "action-id" } });
    await window.fetch("/api/admin/events/example/live");
    for (const call of fetch.mock.calls.slice(2)) expect((call[0] as unknown as Request).headers.has("x-csrf")).toBe(false);
  } finally { act(() => root.unmount()); document.cookie = "__Host-csrf=; Secure; Path=/; Max-Age=0"; }
  expect(window.fetch).toBe(fetch);
});
