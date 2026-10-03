import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { venueLabel } from "./format";
import type { PublicEvent } from "./types";

/**
 * The OG cover's font and pictures, read from packages/ui on disk (Satori needs raw TTF bytes and data URIs).
 * The app runs from apps/events (dev, `next start`, standalone), tests from the repo root. The files are traced
 * into the build by `outputFileTracingIncludes` (next.config.ts), so the dynamic paths are ignored by Turbopack.
 */
function uiDir(): string {
  const candidates = [join(/*turbopackIgnore: true*/ process.cwd(), "../../packages/ui/src"), join(/*turbopackIgnore: true*/ process.cwd(), "packages/ui/src")];
  return candidates.find((d) => existsSync(join(/*turbopackIgnore: true*/ d, "og/Inter-500.ttf"))) ?? candidates[0]!;
}

let cache: Promise<{ font: Buffer; sky: string; aqua: string; logo: string }> | undefined;

export function ogAssets() {
  cache ??= (async () => {
    const dir = uiDir();
    const dataUri = async (file: string, type: string) => `data:${type};base64,${(await readFile(join(/*turbopackIgnore: true*/ dir, file))).toString("base64")}`;
    const [font, sky, aqua, logo] = await Promise.all([
      readFile(join(/*turbopackIgnore: true*/ dir, "og/Inter-500.ttf")),
      dataUri("og/bg-sky.jpg", "image/jpeg"),
      dataUri("og/bg-aqua.jpg", "image/jpeg"),
      dataUri("assets/didit-horizontal-color.png", "image/png"),
    ]);
    return { font, sky, aqua, logo };
  })();
  return cache;
}

/** The `?v=` of a stored cover URL (`/api/events/<id>/cover?v=<version>`), or null. */
export function coverVersion(src: string | null | undefined): string | null {
  return src ? new URL(src, "https://events.local").searchParams.get("v") : null;
}

/**
 * The event's link-preview image path, cache-busted by the cover and banner versions and the text drawn on it, so
 * WhatsApp/LinkedIn/X fetch a fresh picture after a new upload or a title/date/venue edit.
 */
export function ogImagePath(event: Pick<PublicEvent, "slug" | "title" | "accent" | "startsAt" | "timeZone" | "venue" | "cover">): string {
  const key = createHash("sha256")
    .update(JSON.stringify([coverVersion(event.cover.src), coverVersion(event.cover.wideSrc), event.title, event.accent ?? "", event.startsAt, event.timeZone, venueLabel(event.venue), event.cover.theme]))
    .digest("hex")
    .slice(0, 12);
  return `/e/${encodeURIComponent(event.slug)}/opengraph-image?v=${key}`;
}

/** The site-wide link preview (app/og/default): pages without their own image use it. */
export const DEFAULT_OG_IMAGE = { url: "/og/default", width: 1200, height: 630, alt: "Didit Events" };
