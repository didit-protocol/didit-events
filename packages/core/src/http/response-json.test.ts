import { expect, it, vi } from "vitest";
import { PROVIDER_JSON_MAX_BYTES, responseJson, ResponseTooLarge } from "./response-json.ts";

it("accepts exactly the byte limit and preserves split UTF-8 characters", async () => {
  const value = "é".repeat((PROVIDER_JSON_MAX_BYTES - 2) / 2);
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const response = new Response(new ReadableStream({ start(c) {
    c.enqueue(bytes.slice(0, 2)); c.enqueue(bytes.slice(2)); c.close();
  } }));
  expect(await responseJson(response)).toBe(value);
});

it.each([undefined, "1", String(PROVIDER_JSON_MAX_BYTES + 1)])("cancels oversized streams with content-length %j before parsing JSON", async length => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({
    pull(c) { c.enqueue(new Uint8Array(64 * 1024)); }, cancel,
  }), { headers: length ? { "content-length": length } : {} });
  await expect(responseJson(response)).rejects.toBeInstanceOf(ResponseTooLarge);
  expect(cancel).toHaveBeenCalledOnce();
  expect(response.body!.locked).toBe(false);
});

it("rejects malformed JSON and invalid UTF-8", async () => {
  await expect(responseJson(new Response("{"))).rejects.toBeInstanceOf(SyntaxError);
  await expect(responseJson(new Response(new Uint8Array([34, 255, 34])))).rejects.toBeInstanceOf(TypeError);
});
