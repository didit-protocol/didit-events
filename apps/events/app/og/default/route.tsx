import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { OG_FONT_FAMILY, OG_SIZE } from "@didit-events/ui/og";
import { ogAssets } from "../../../src/public/og";

const W = OG_SIZE.width, H = OG_SIZE.height, BLUE = "#2567FF", MUTED = "#5B5B6B";

/** The face rings of the event cover art (same proportions as EventCoverOg), here large and bleeding off the right edge. */
function Rings({ cx, cy, base }: { cx: number; cy: number; base: number }) {
  return (
    <>
      {[1, 0.8, 0.62, 0.46, 0.3].map((k, i) => {
        const w = base * k * 0.78, h = base * k;
        return <div key={i} style={{ position: "absolute", display: "flex", left: cx - w / 2, top: cy - h / 2, width: w, height: h, borderRadius: "50%", border: i === 2 ? `3px solid ${BLUE}` : "1.5px solid rgba(254,254,254,.65)", ...(i === 2 ? { boxShadow: "0 0 48px rgba(37,103,255,.2)" } : null) }} />;
      })}
      <div style={{ position: "absolute", display: "flex", left: cx - base * 0.62 * 0.78 * 0.43, top: cy - 1.5, width: base * 0.62 * 0.78 * 0.86, height: 3, background: "#4D94FF", borderRadius: 999, boxShadow: "0 0 28px 8px rgba(77,148,255,.35)", opacity: 0.75 }} />
    </>
  );
}

/**
 * The default link preview of events.didit.me (home, /events and any page without its own image): the sky cover art
 * with big face rings, the Didit logo, "Events" in Didit Blue and a proof row (Alberto picked "Sky 7", 2026-10-02).
 * Static, so cached for a day by browsers and crawlers.
 */
export async function GET() {
  const { font, sky, logo } = await ogAssets();
  const art: ReactElement = (
    <div style={{ width: W, height: H, display: "flex", position: "relative", overflow: "hidden", background: "#FEFEFE", fontFamily: OG_FONT_FAMILY }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={sky} width={W} height={H} alt="" style={{ position: "absolute", left: 0, top: 0, width: W, height: H, objectFit: "cover" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex", backgroundImage: "linear-gradient(90deg, rgba(254,254,254,.85) 0%, rgba(254,254,254,.5) 45%, rgba(254,254,254,0) 75%)" }} />
      <Rings cx={W - 170} cy={H / 2 + 20} base={820} />
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, padding: "64px 72px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} height={44} width={Math.round((44 * 720) / 249)} alt="" />
        <div style={{ display: "flex", marginTop: 28, fontSize: 120, lineHeight: 1, letterSpacing: "-0.04em", color: BLUE }}>Events</div>
        <div style={{ display: "flex", marginTop: 22, fontSize: 15, letterSpacing: "0.08em", color: MUTED }}>BARCELONA · SAN FRANCISCO · FACE CHECK-IN</div>
      </div>
    </div>
  );
  return new ImageResponse(art, { ...OG_SIZE, fonts: [{ name: OG_FONT_FAMILY, data: font, weight: 500, style: "normal" }], headers: { "Cache-Control": "public, max-age=86400" } });
}
