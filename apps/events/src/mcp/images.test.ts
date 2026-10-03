import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { get } from "node:https";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { beforeEach, expect, it, vi } from "vitest";
import { decodeEventCover, downloadImage } from "./images";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ get: vi.fn() }));
const lookupAll = vi.mocked(lookup as (hostname: string, options: { all: true }) => Promise<LookupAddress[]>);
beforeEach(() => { vi.resetAllMocks(); lookupAll.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]); });

function respond(status: number, headers: Record<string, string>, chunks: Buffer[]) {
  vi.mocked(get).mockImplementation((...args: unknown[]) => {
    const callback = args[2] as (response: IncomingMessage) => void;
    const response = Object.assign(new PassThrough(), { statusCode: status, headers });
    queueMicrotask(() => { callback(response as unknown as IncomingMessage); for (const chunk of chunks) response.write(chunk); response.end(); });
    return new EventEmitter() as ClientRequest;
  });
}
it("downloads only a direct supported image and pins the validated DNS address", async () => {
  respond(200, { "content-type": "image/png" }, [Buffer.from("png bytes")]);
  expect(await downloadImage("https://images.example.test/image.png")).toEqual(new Uint8Array(Buffer.from("png bytes")));
  const options = vi.mocked(get).mock.calls[0]![1] as { lookup: (_host: string, options: { all: boolean }, callback: (...args: unknown[]) => void) => void; agent: boolean; signal: AbortSignal };
  const callback = vi.fn(); options.lookup("images.example.test", { all: false }, callback);
  expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4); expect(options.agent).toBe(false); expect(options.signal).toBeInstanceOf(AbortSignal);
});
it.each([
  [302, { "content-type": "image/png", location: "https://127.0.0.1/secret" }, [Buffer.from("x")]],
  [200, { "content-type": "text/html" }, [Buffer.from("html")]],
  [200, { "content-type": "image/png", "content-length": "5242881" }, []],
  [200, { "content-type": "image/png" }, [Buffer.alloc(3 * 1024 * 1024), Buffer.alloc(3 * 1024 * 1024)]],
] as const)("rejects redirects, MIME mismatches and oversized streams (%s)", async (status, headers, chunks) => {
  respond(status, headers, [...chunks]);
  await expect(downloadImage("https://images.example.test/image.png")).rejects.toThrow();
  expect(get).toHaveBeenCalledTimes(1);
});
it("rejects a mixed public/private DNS answer before connecting", async () => {
  lookupAll.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  await expect(downloadImage("https://images.example.test/image.png")).rejects.toThrow("public internet");
  expect(get).not.toHaveBeenCalled();
});

it("accepts exactly 5 MiB base64 without recursion, and rejects oversized or noncanonical data", () => {
  const bytes=Buffer.alloc(5*1024*1024,42);
  // Buffer.equals, not toEqual: deep-equality over 5 MiB took ~55 s on CI runners and timed out.
  expect(Buffer.from(decodeEventCover(bytes.toString("base64"))).equals(bytes)).toBe(true);
  expect(Buffer.from(decodeEventCover("data:image/png;base64,YQ=="))).toEqual(Buffer.from("a"));
  for(const value of ["", "YQ", "YQ==\n", "YR==", "data:image/svg+xml;base64,YQ==", Buffer.alloc(5*1024*1024+1).toString("base64")]) expect(()=>decodeEventCover(value)).toThrow();
});
