// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareCover } from "./cover";
import { COVER_MAX_BYTES } from "./validate";

const file = (bytes: number, type: string, name = "photo.jpg") => new File([new Uint8Array(bytes)], name, { type });

describe("prepareCover (in-browser downscale before the server action)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("passes a JPG or PNG under the limit through untouched", async () => {
    const small = file(1024, "image/png");
    expect(await prepareCover(small)).toEqual({ ok: true, file: small });
  });
  it("rejects non-images", async () => {
    expect(await prepareCover(file(10, "application/pdf", "a.pdf"))).toEqual({ ok: false, error: "Use a JPG or PNG" });
  });
  it("re-encodes a 20 MB photo to a JPEG under the limit (the staging crash, FCS 18.jpg)", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 6000, height: 4000, close: () => {} }));
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => {} })) as never;
    let size: [number, number] = [0, 0];
    const out = await prepareCover(file(20_850_283, "image/jpeg", "FCS 18.jpg"), async (c) => { size = [c.width, c.height]; return new Blob([new Uint8Array(900_000)], { type: "image/jpeg" }); });
    expect(size).toEqual([2400, 1600]);
    expect(out.ok && out.file.size).toBe(900_000);
    expect(out.ok && out.file.name).toBe("FCS 18.jpg");
  });
  it("explains when even the resized image is too large, and when it can't be decoded", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 3000, height: 2000, close: () => {} }));
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: () => {} })) as never;
    const huge = await prepareCover(file(30 * 1024 * 1024, "image/jpeg"), async () => new Blob([new Uint8Array(COVER_MAX_BYTES + 1)]));
    expect(huge).toEqual({ ok: false, error: "That image is too large (30.0 MB). Use one under 5 MB" });
    vi.stubGlobal("createImageBitmap", async () => { throw new Error("decode"); });
    expect(await prepareCover(file(10, "image/heic", "x.heic"))).toEqual({ ok: false, error: "We couldn't read that image. Use a JPG or PNG" });
  });
});
