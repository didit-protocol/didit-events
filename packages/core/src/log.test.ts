import { expect, it } from "vitest";
import { createLogger, redact } from "./log.ts";
it("recursively drops images, bodies, keys, tokens and nested secrets without logging exception messages", () => {
  const lines: string[] = [], log = createLogger(line => lines.push(line));
  log("scan.failed", { eventId: "safe", image: "IMAGE", rawBody: "BODY", apiKey: "KEY", headers: { Authorization: "BEARER", cookie: "COOKIE" }, nested: [{ secret: "SECRET", tokenHash: "HASH", status: 403 }], exception: new Error("BODY with KEY"), frame: new Uint8Array([1, 2]) });
  expect(lines).toEqual(['{"event":"scan.failed","fields":{"eventId":"safe","headers":{},"nested":[{"status":403}],"exception":{"error":"Error"},"frame":"[Binary]"}}']);
  const circular: Record<string, unknown> = {}; circular.self = circular; expect(redact(circular)).toEqual({ self: "[Circular]" });
});
