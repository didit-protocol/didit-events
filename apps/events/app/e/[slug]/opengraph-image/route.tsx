import { readEventCover } from "@didit-events/core/content/event-assets";
import sharp from "sharp";
import { ImageResponse } from "next/og";
import { EventCoverOg, OG_FONT_FAMILY, OG_SIZE } from "@didit-events/ui/og";
import { EventBannerOg, EventSquareCoverOg, ogBannerHeight } from "@didit-events/ui/og/banner";
import { COVER_EYEBROW, COVER_TAG, fullShortDate, time, venueLabel, zoneName } from "../../../../src/public/format";
import { coverVersion, ogAssets } from "../../../../src/public/og";
import type { PublicEvent } from "../../../../src/public/types";
import { getEvent } from "../data";

// V-01 OG / link preview (1200×630). A plain route rather than the `opengraph-image` file convention so the page can
// point og:image / twitter:image at a URL cache-busted by the cover versions (`ogImagePath`, ?v= is ignored here).
const SQUARE = 550;

async function stored(event: PublicEvent, src: string | null | undefined): Promise<Buffer | null> {
  const version = coverVersion(src);
  if (!event.id || !version) return null;
  const res = await readEventCover(event.id, version);
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}
const dataUri = (png: Buffer, type = "image/png") => `data:${type};base64,${png.toString("base64")}`;

async function picture(event: PublicEvent | null) {
  if (!event) return null;
  const banner = await stored(event, event.cover.wideSrc);
  if (banner) {
    // The banner keeps its own ratio (cover-fit into a 1200-wide band, never stretched).
    const meta = await sharp(banner).metadata();
    const height = ogBannerHeight(meta.width ?? 0, meta.height ?? 0);
    const jpeg = await sharp(banner).resize(OG_SIZE.width, height, { fit: "cover" }).flatten({ background: "#FEFEFE" }).jpeg({ quality: 88 }).toBuffer();
    return { kind: "banner" as const, src: dataUri(jpeg, "image/jpeg"), height };
  }
  const square = await stored(event, event.cover.src);
  if (square) {
    // Scaled to fit, so the cover's own title is never cut.
    const png = await sharp(square).resize(SQUARE, SQUARE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    return { kind: "square" as const, src: dataUri(png) };
  }
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const event = await getEvent((await params).slug);
  const [{ font, sky, aqua, logo }, pic] = await Promise.all([ogAssets(), picture(event)]);
  const tz = event?.timeZone ?? "Europe/Madrid";
  const date = event ? fullShortDate(event.startsAt, tz) : "";
  const doors = event ? `${time(event.startsAt, tz)} ${zoneName(event.startsAt, tz)}` : "";
  const venue = event ? venueLabel(event.venue) : "";
  const cover =
    event && pic?.kind === "banner" ? (
      <EventBannerOg banner={pic.src} bannerHeight={pic.height} title={event.title} accent={event.accent} meta={[date, doors, venue].filter(Boolean).join(" · ")} logo={logo} />
    ) : event && pic?.kind === "square" ? (
      <EventSquareCoverOg cover={pic.src} coverSize={SQUARE} photo={event.cover.theme === "aqua" ? aqua : sky} aqua={event.cover.theme === "aqua"} date={date} doors={doors} venue={venue} logo={logo} />
    ) : event ? (
      <EventCoverOg
        theme={event.cover.theme}
        title={event.title}
        accent={event.accent ?? ""}
        date={date}
        doors={doors}
        venue={venue}
        eyebrow={event.cover.eyebrow ?? COVER_EYEBROW}
        tag={event.cover.tag ?? COVER_TAG}
        panels={event.panels.map((p) => p.title)}
        photo={event.cover.theme === "aqua" ? aqua : sky}
        logo={logo}
      />
    ) : (
      <EventCoverOg title="Didit" accent="Events" date="" doors="" venue="" photo={sky} logo={logo} eyebrow="EVENTS BY DIDIT" tag="DIDIT EVENTS" />
    );
  return new ImageResponse(cover, {
    ...OG_SIZE,
    fonts: [{ name: OG_FONT_FAMILY, data: font, weight: 500, style: "normal" }],
    // A versioned URL (?v=, a hash of everything drawn) never changes: cache it for a year; the bare URL for 5 minutes.
    headers: { "Cache-Control": new URL(request.url).searchParams.get("v") ? "public, max-age=31536000, immutable" : "public, max-age=300" },
  });
}
