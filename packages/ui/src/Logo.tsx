import color from "./assets/didit-horizontal-color.png";
import mark from "./assets/didit-mark.png";
import white from "./assets/didit-horizontal-white.png";
import whiteGradient from "./assets/didit-horizontal-white-gradient.png";

type StaticImage = string | { src: string; width?: number; height?: number };

/** Intrinsic asset sizes (the files in ./assets), so sizing works with any bundler's image import shape. */
const LOGOS = {
  color: { img: color as StaticImage, w: 720, h: 249 },
  white: { img: white as StaticImage, w: 720, h: 249 },
  mark: { img: mark as StaticImage, w: 549, h: 720 },
  "white-gradient": { img: whiteGradient as StaticImage, w: 0, h: 0 },
} as const;

export type LogoVariant = keyof typeof LOGOS;

/** The logo height of every page header (site header, admin sidebar, sheets): one size, so it never jumps between pages. */
export const HEADER_LOGO_HEIGHT = 24;

export function assetSrc(img: StaticImage): string {
  return typeof img === "string" ? img : img.src;
}

export interface LogoProps {
  /** color (light surfaces), white (dark surfaces), mark (square-ish glyph), white-gradient (L0 dark hero). */
  variant?: LogoVariant;
  /** Rendered width in CSS pixels; height follows the aspect ratio. Ignored when `height` is set. */
  width?: number;
  /** Rendered height in CSS pixels (the design sizes logos by height: 18 / 22 / 44). */
  height?: number;
  className?: string;
  priority?: boolean;
  alt?: string;
}

/**
 * Didit logo. A plain <img> on purpose: next/image adds ~6 KB of client JS to every page for a fixed-size logo.
 */
export function Logo({ variant = "white-gradient", width, height, className, priority, alt = "Didit" }: LogoProps) {
  const def = LOGOS[variant];
  const img = def.img;
  const iw = def.w || (typeof img === "string" ? 0 : (img.width ?? 0)) || 720;
  const ih = def.h || (typeof img === "string" ? 0 : (img.height ?? 0)) || 249;
  const h = height ?? Math.round(((width ?? 120) * ih) / iw);
  const w = height !== undefined ? Math.round((height * iw) / ih) : (width ?? 120);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={assetSrc(img)}
      alt={alt}
      width={w}
      height={h}
      className={className}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
    />
  );
}
