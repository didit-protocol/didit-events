import { describe, expect, it } from "vitest";
import { ease, easeBox, placeTag } from "./layout";
import { fitName } from "./tags";

const bounds = { left: 32, top: 132, right: 1888, bottom: 970 };
const tag = { w: 400, h: 110 };

describe("tag layout", () => {
  it("centres the tag above the face", () => {
    expect(placeTag({ x: 800, y: 500, w: 200, h: 240 }, tag, bounds)).toEqual({ x: 700, y: 500 - 14 - 110, placement: "above" });
  });
  it("flips below the face near the top edge", () => {
    expect(placeTag({ x: 800, y: 150, w: 200, h: 240 }, tag, bounds)).toEqual({ x: 700, y: 150 + 240 + 14, placement: "below" });
  });
  it("clamps horizontally so the tag never leaves the screen", () => {
    expect(placeTag({ x: 0, y: 500, w: 100, h: 120 }, tag, bounds).x).toBe(32);
    expect(placeTag({ x: 1850, y: 500, w: 70, h: 80 }, tag, bounds).x).toBe(1888 - 400);
  });
  it("stays on screen for a face filling the bottom of the frame", () => {
    const p = placeTag({ x: 600, y: 140, w: 700, h: 940 }, tag, bounds);
    expect(p.y).toBeGreaterThanOrEqual(bounds.top);
    expect(p.y + tag.h).toBeLessThanOrEqual(bounds.bottom);
  });
  it("a tag wider than the screen is pinned to the left bound", () => {
    expect(placeTag({ x: 500, y: 500, w: 100, h: 100 }, { w: 3000, h: 100 }, bounds).x).toBe(32);
  });
  it("eases towards the target and snaps on a far jump", () => {
    const half = ease(0, 100, 90 * Math.LN2);
    expect(half).toBeCloseTo(50, 5);
    expect(ease(0, 1000, 16)).toBe(1000);
    expect(ease(Number.NaN, 5, 16)).toBe(5);
    expect(easeBox(null, { x: 1, y: 2, w: 3, h: 4 }, 16)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});

describe("name truncation", () => {
  it("keeps short names and cuts long ones with an ellipsis", () => {
    expect(fitName("Albert Rosas")).toBe("Albert Rosas");
    expect(fitName("  Maximiliana   Alessandra Fitzgerald-Montgomery ")).toBe("Maximiliana Alessandra Fi…");
    expect([...fitName("Maximiliana Alessandra Fitzgerald-Montgomery")]).toHaveLength(26);
    expect(fitName("José María Ñúñez de Balboa y Castellanos", 12)).toBe("José María…");
  });
});
