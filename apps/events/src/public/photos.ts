import { assetSrc, type CoverTheme } from "@didit-events/ui";
import bgAqua from "@didit-events/ui/assets/bg-aqua.webp";
import bgSky from "@didit-events/ui/assets/bg-sky.webp";

/** The blurred sky / aqua photo behind covers and thumbnails. */
export const coverPhoto = (theme: CoverTheme) => assetSrc(theme === "aqua" ? bgAqua : bgSky);

/** Display widths the cover route resizes to (core `COVER_WIDTHS`): thumbnails, the hero on a phone, the hero at 2–3x. */
export type CoverDisplayWidth = 192 | 720 | 1080;
/**
 * An uploaded cover at a display width, never the up-to-4096px original (that stays at the bare URL for downloads and
 * the OG art). Stored covers are versioned URLs (`…/cover?v=…`); theme photos are plain asset paths and pass through.
 */
export const coverAt = (src: string, width: CoverDisplayWidth) => (src.includes("?") ? `${src}&w=${width}` : src);
/** An event's cover for a box of that width: its upload at the display width, else the theme photo. */
export const coverSrc = (cover: { src?: string | null; theme: CoverTheme }, width: CoverDisplayWidth) => (cover.src ? coverAt(cover.src, width) : coverPhoto(cover.theme));
/** `srcset` of the hero cover; with `HERO_COVER_SIZES` a phone at 2x fetches 720px, a 3x phone or a dense desktop 1080px. */
export const heroCoverSrcSet = (src: string) => (src.includes("?") ? `${coverAt(src, 720)} 720w, ${coverAt(src, 1080)} 1080w` : undefined);
/** The event page shows the cover across the phone column (width − 32px, at most 480px) and at 330px from 768px. */
export const HERO_COVER_SIZES = "(max-width: 767px) min(480px, calc(100vw - 32px)), 330px";
