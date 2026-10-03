// Low-light handling of a recognition crop before upload: auto levels + gamma when it is dark, and a refusal when no
// amount of brightening would leave a usable face (the door asks for more light instead of spending a scan). Pure.

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface LightConfig {
  /** Crops with a mean luma (0–255) at or above this are sent as they are. */
  darkBelow: number;
  /** Mean luma a dark crop is brightened to. */
  target: number;
  /** Levels are stretched between these luma percentiles (ignores a few hot or dead pixels). */
  lowPercentile: number;
  highPercentile: number;
  /** Too dark: the brightest part of the face is below this luma… */
  minHighlight: number;
  /** …or the face spans fewer luma levels than this (stretching it would only amplify sensor noise)… */
  minRange: number;
  /** …or brightening still leaves the mean below this. */
  minAfter: number;
}

export const DEFAULT_LIGHT: Readonly<LightConfig> = Object.freeze({
  darkBelow: 100,
  target: 120,
  lowPercentile: 0.01,
  highPercentile: 0.99,
  minHighlight: 40,
  minRange: 24,
  minAfter: 80,
});

export const MORE_LIGHT = "More light, please";

export interface LightResult {
  /** Mean luma before and after. */
  before: number;
  after: number;
  /** The pixels were rewritten. */
  adjusted: boolean;
  /** Not worth scanning: show MORE_LIGHT and make no scan call. */
  tooDark: boolean;
}

const luma = (d: Uint8ClampedArray, o: number) => 0.299 * d[o]! + 0.587 * d[o + 1]! + 0.114 * d[o + 2]!;

function histogram(img: RgbaImage): { hist: Uint32Array; n: number; mean: number } {
  const hist = new Uint32Array(256), n = img.width * img.height;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = luma(img.data, i * 4);
    sum += v;
    hist[Math.min(255, Math.round(v))]!++;
  }
  return { hist, n, mean: n ? sum / n : 0 };
}

function percentile(hist: Uint32Array, n: number, p: number): number {
  const rank = p * n;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v]!;
    if (seen > rank) return v;
  }
  return 255;
}

/**
 * Brightens `img` in place when it is dark: levels stretch the face's [p1, p99] luma to the full range, then a gamma
 * (≤ 1, found on the histogram) lifts the mean to `target`. The same curve is applied to R, G and B so skin keeps its
 * hue. Bright crops are left untouched.
 */
export function normalizeLight(img: RgbaImage, config: LightConfig = DEFAULT_LIGHT): LightResult {
  const { hist, n, mean } = histogram(img);
  if (!n || mean >= config.darkBelow) return { before: mean, after: mean, adjusted: false, tooDark: false };
  const low = percentile(hist, n, config.lowPercentile), high = percentile(hist, n, config.highPercentile);
  if (high < config.minHighlight || high - low < config.minRange) return { before: mean, after: mean, adjusted: false, tooDark: true };
  const stretch = (v: number) => Math.min(1, Math.max(0, (v - low) / (high - low)));
  const meanAt = (gamma: number) => {
    let sum = 0;
    for (let v = 0; v < 256; v++) if (hist[v]) sum += hist[v]! * stretch(v) ** gamma;
    return (255 * sum) / n;
  };
  // The mean falls as gamma grows; bisect for the gamma that lands on target, never darkening (gamma ≤ 1).
  let lo = 0.25, hi = 1;
  if (meanAt(hi) < config.target) {
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (meanAt(mid) < config.target) hi = mid;
      else lo = mid;
    }
  }
  const gamma = hi;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * stretch(v) ** gamma);
  const d = img.data;
  for (let o = 0; o < d.length; o += 4) {
    d[o] = lut[d[o]!]!;
    d[o + 1] = lut[d[o + 1]!]!;
    d[o + 2] = lut[d[o + 2]!]!;
  }
  const after = histogram(img).mean;
  return { before: mean, after, adjusted: true, tooDark: after < config.minAfter };
}
