import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { expect, it } from "vitest";
import { GET } from "../../app/og/default/route";

it("/og/default: the sky 1200×630 cover art with big rings and a Blue \"Events\" (Sky 7), cached for a day", async () => {
  const res = await GET();
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
  const png = Buffer.from(await res.arrayBuffer());
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  if (process.env.OG_OUT) writeFileSync(`${process.env.OG_OUT}-default.png`, png); // manual look: OG_OUT=/tmp/og
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)] as [number, number, number];
  const blue = ([r, g, b]: [number, number, number]) => b > 200 && r < 110 && g < 150;
  const count = (x0: number, x1: number, y0: number, y1: number) => {
    let n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if (blue(pixel(x, y))) n++;
    return n;
  };
  // "Events" in Didit Blue on the left, the Blue face ring on the right; the corners are the light sky art, never black.
  expect(count(72, 520, 300, 430)).toBeGreaterThan(400);
  expect(count(780, 1200, 0, 630)).toBeGreaterThan(200);
  for (const [x, y] of [[4, 4], [4, 625]] as const) expect(pixel(x, y).every((c) => c > 180)).toBe(true);
});
