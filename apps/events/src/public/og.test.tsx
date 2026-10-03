import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampOgTitle, ogBannerHeight, ogTitleWords } from "@didit-events/ui/og/banner";
import { GET } from "../../app/e/[slug]/opengraph-image/route";
import { findEvent } from "./fixtures";
import { ogImagePath } from "./og";
import type { PublicEvent } from "./types";

const ID = "6f1c3c2e-1d1b-4c55-9d8e-3f3d1f2a9b10";
const MAIN = "11111111-1111-4111-8111-111111111111";
const WIDE = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({ events: new Map<string, unknown>(), assets: new Map<string, Buffer>(), reads: [] as (string | null)[] }));

vi.mock("../../app/e/[slug]/data", async () => {
  const { findEvent: find } = await import("./fixtures");
  return { getEvent: async (slug: string) => state.events.get(slug) ?? find(slug) };
});
vi.mock("@didit-events/core/content/event-assets", () => ({
  readEventCover: async (_id: string, version: string | null) => {
    state.reads.push(version);
    const bytes = version && state.assets.get(version);
    return bytes ? new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp" } }) : new Response(null, { status: 404 });
  },
}));

const solid = (width: number, height: number, rgb: [number, number, number]) =>
  sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).webp().toBuffer();
const withCover = (cover: Partial<PublicEvent["cover"]>): PublicEvent => {
  const base = findEvent("ai-era")!;
  return { ...base, id: ID, slug: "covered", cover: { ...base.cover, ...cover } };
};
let shots = 0;
async function render(slug: string) {
  const res = await GET(new Request(`https://events.local/e/${slug}/opengraph-image`), { params: Promise.resolve({ slug }) });
  expect(res.headers.get("content-type")).toBe("image/png");
  const png = Buffer.from(await res.arrayBuffer());
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  if (process.env.OG_OUT) writeFileSync(`${process.env.OG_OUT}-${slug}-${++shots}.png`, png); // manual look: OG_OUT=/tmp/og
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
  return { pixel };
}
const near = (px: number[], rgb: number[]) => px.every((v, i) => Math.abs(v - rgb[i]!) < 24);

describe("/e/[slug]/opengraph-image (V-01 OG / link preview)", () => {
  beforeEach(() => {
    state.events.clear();
    state.assets.clear();
    state.reads.length = 0;
  });

  it("renders the default 1200×630 PNG design without an uploaded cover", async () => {
    await render("ai-era");
    expect(state.reads).toEqual([]);
  }, 60_000);

  it("uses the wide banner for the top band and a white text band below", async () => {
    state.assets.set(WIDE, await solid(1000, 300, [230, 20, 20]));
    state.assets.set(MAIN, await solid(800, 800, [20, 200, 20]));
    state.events.set("covered", withCover({ src: `/api/events/${ID}/cover?v=${MAIN}`, wideSrc: `/api/events/${ID}/cover?v=${WIDE}` }));
    const { pixel } = await render("covered");
    expect(state.reads).toEqual([WIDE]); // the square cover is not read when a banner exists
    expect(near(pixel(20, 20), [230, 20, 20])).toBe(true);
    expect(near(pixel(1180, 340), [230, 20, 20])).toBe(true); // 10:3 → a 360px band, full width
    expect(near(pixel(20, 600), [254, 254, 254])).toBe(true);
    expect(near(pixel(1180, 600), [254, 254, 254])).toBe(true);
  }, 60_000);

  it("falls back to the square cover scaled to fit, never cropped", async () => {
    state.assets.set(MAIN, await solid(800, 800, [20, 200, 20]));
    state.events.set("covered", withCover({ src: `/api/events/${ID}/cover?v=${MAIN}`, wideSrc: null }));
    const { pixel } = await render("covered");
    expect(state.reads).toEqual([MAIN]);
    // 550×550 in the centre: every edge of the cover is inside the frame.
    for (const [x, y] of [[600, 315], [340, 315], [860, 315], [600, 55], [600, 575]] as const) expect(near(pixel(x, y), [20, 200, 20])).toBe(true);
    for (const [x, y] of [[600, 20], [600, 610], [200, 315], [1000, 315]] as const) expect(near(pixel(x, y), [20, 200, 20])).toBe(false);
  }, 60_000);

  it("falls back to the default design when the stored covers cannot be read", async () => {
    state.events.set("covered", withCover({ src: `/api/events/${ID}/cover?v=${MAIN}`, wideSrc: `/api/events/${ID}/cover?v=${WIDE}` }));
    await render("covered");
    expect(state.reads).toEqual([WIDE, MAIN]);
  }, 60_000);
});

describe("OG title and band helpers", () => {
  it("keeps the banner's natural ratio within 300–400px", () => {
    expect(ogBannerHeight(1000, 300)).toBe(360);
    expect(ogBannerHeight(1200, 200)).toBe(300);
    expect(ogBannerHeight(1200, 900)).toBe(400);
  });

  it("clamps the title to two lines with an ellipsis", () => {
    const lines = clampOgTitle(ogTitleWords("Building, Raising & Scaling in the", "AI Era"), 600, 44);
    expect(lines.length).toBeLessThanOrEqual(2);
    const long = clampOgTitle(ogTitleWords("A very long event title that keeps going well past what two lines of the preview could ever hold"), 600, 44);
    expect(long).toHaveLength(2);
    expect(long[1]!.at(-1)!.w.endsWith("…")).toBe(true);
    expect(clampOgTitle(ogTitleWords("Short"), 600, 44)).toEqual([[{ w: "Short", accent: false }]]);
  });
});

describe("event page link-preview metadata", () => {
  it("points og:image and twitter:image at the cache-busted 1200×630 PNG", async () => {
    const { generateMetadata } = await import("../../app/e/[slug]/page");
    const meta = await generateMetadata({ params: Promise.resolve({ slug: "ai-era" }), searchParams: Promise.resolve({}) });
    const image = { url: ogImagePath(findEvent("ai-era")!), width: 1200, height: 630, alt: "Building, Raising & Scaling in the AI Era", type: "image/png" };
    expect(image.url).toMatch(/^\/e\/ai-era\/opengraph-image\?v=[0-9a-f]{12}$/);
    expect(meta.openGraph?.images).toEqual([image]);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [image] });
  });

  it("changes the image URL when a cover or banner version changes", () => {
    const a = ogImagePath(withCover({ src: `/api/events/${ID}/cover?v=${MAIN}` }));
    const b = ogImagePath(withCover({ src: `/api/events/${ID}/cover?v=${MAIN}`, wideSrc: `/api/events/${ID}/cover?v=${WIDE}` }));
    const c = ogImagePath(withCover({ src: `/api/events/${ID}/cover?v=${WIDE}`, wideSrc: `/api/events/${ID}/cover?v=${WIDE}` }));
    expect(new Set([a, b, c]).size).toBe(3);
    expect(ogImagePath(withCover({ src: `/api/events/${ID}/cover?v=${MAIN}` }))).toBe(a);
  });
});
