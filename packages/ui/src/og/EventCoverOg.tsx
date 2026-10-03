import type { CSSProperties } from "react";
import type { CoverTheme } from "../components/EventCover";

/**
 * The V-01 OG cover (1200×630) as a Satori-safe tree for `next/og` `ImageResponse`: same geometry and copy as
 * `<EventCover format="og">`, but with every multi-child box `display: flex`, pixel positions instead of
 * percentage transforms, letter-spacing in px, the photo as an <img> and the title split into words so it wraps.
 * Satori reads neither CSS variables nor woff2/webp, so the caller passes data URIs for the photo and logo and
 * loads `og/Inter-500.ttf` (a static Inter 500 instance) as the font.
 */
export interface EventCoverOgProps {
  theme?: CoverTheme;
  title: string;
  accent?: string;
  date: string;
  doors: string;
  venue: string;
  eyebrow?: string;
  tag?: string;
  panels?: string[];
  /** data: URI of og/bg-sky.jpg or og/bg-aqua.jpg. */
  photo: string;
  /** data: URI of assets/didit-horizontal-color.png. */
  logo: string;
}

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_FONT_FAMILY = "Inter";

const FG = "#1A1A1A";
const SUB = "#4B5058";
const MUTED = "#6E6E73";
const BRAND = "#2567FF";
const LINE = "rgba(157,161,161,.4)";

const em = (size: number, k: number) => Math.round(size * k * 100) / 100;

export function EventCoverOg({
  theme = "sky",
  title,
  accent,
  date,
  doors,
  venue,
  eyebrow = "AN EVENING FOR FOUNDERS",
  tag = "DIDIT EVENTS · BARCELONA",
  panels = [],
  photo,
  logo,
}: EventCoverOgProps) {
  const { width: W, height: H } = OG_SIZE;
  const pad = 64;
  const cx = W * 0.85;
  const cy = H * 0.5;
  const base = 560;
  const sw = base * 0.62 * 0.78;
  const aqua = theme === "aqua";
  const label = (size: number, spacing = 0.14): CSSProperties => ({ fontSize: size, fontWeight: 500, letterSpacing: em(size, spacing), color: MUTED });
  const words = [
    ...title.split(/\s+/).filter(Boolean).map((w) => ({ w, accent: false })),
    ...(accent ?? "").split(/\s+/).filter(Boolean).map((w) => ({ w, accent: true })),
  ];

  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative", overflow: "hidden", background: "#FEFEFE", color: FG, fontFamily: OG_FONT_FAMILY }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo} width={W} height={H} alt="" style={{ position: "absolute", left: 0, top: 0, width: W, height: H, objectFit: "cover", ...(aqua ? { transform: "scaleX(-1)" } : null) }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: H,
          display: "flex",
          backgroundImage: `linear-gradient(${aqua ? "270deg" : "90deg"}, rgba(254,254,254,.72) 0%, rgba(254,254,254,.35) 45%, rgba(254,254,254,0) 75%)`,
        }}
      />
      {[1, 0.8, 0.62, 0.46, 0.3].map((k, i) => {
        const w = base * k * 0.78;
        const h = base * k;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              display: "flex",
              left: cx - w / 2,
              top: cy - h / 2,
              width: w,
              height: h,
              borderRadius: "50%",
              border: i === 2 ? `3px solid ${BRAND}` : "1.5px solid rgba(254,254,254,.6)",
              ...(i === 2 ? { boxShadow: "0 0 48px rgba(37,103,255,.18)" } : null),
              opacity: i === 2 ? 0.9 : 1,
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          display: "flex",
          left: cx - (sw * 0.86) / 2,
          top: cy - 1.5,
          width: sw * 0.86,
          height: 3,
          background: "#4D94FF",
          borderRadius: 999,
          boxShadow: "0 0 28px 8px rgba(77,148,255,.35)",
          opacity: 0.7,
        }}
      />
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, padding: pad, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} height={34} width={Math.round((34 * 720) / 249)} alt="" />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: 36,
              padding: "0 16px",
              borderRadius: 999,
              background: "rgba(254,254,254,.75)",
              border: `1px solid ${LINE}`,
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: em(13, 0.12),
              color: SUB,
            }}
          >
            <div style={{ display: "flex", width: 8, height: 8, borderRadius: 999, background: BRAND, marginRight: 10 }} />
            {tag}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 740 }}>
          <div style={{ display: "flex", ...label(14), color: BRAND, marginBottom: 22 }}>{eyebrow}</div>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: 72, fontWeight: 500, lineHeight: 1, letterSpacing: em(72, -0.045) }}>
            {words.map((word, i) => (
              <span key={i} style={{ color: word.accent ? BRAND : FG, marginRight: i === words.length - 1 ? 0 : 18 }}>
                {word.w}
              </span>
            ))}
          </div>
          {panels.length ? (
            <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${LINE}`, maxWidth: 620, marginTop: 22 }}>
              {panels.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", padding: "12px 0", borderBottom: `1px solid ${LINE}`, fontSize: 22, fontWeight: 500, letterSpacing: em(22, -0.02) }}>
                  <span style={{ ...label(14, 0.12), width: 28, marginRight: 18 }}>{String(i + 1).padStart(2, "0")}</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          {/* No date/doors/venue at all (the site-wide default image): no empty labels. */}
          {(date || doors || venue ? [
            ["DATE", date],
            ["DOORS", doors],
            ["VENUE", venue],
          ] : []).map(([k, v], i) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", marginLeft: i ? 48 : 0, fontSize: 20, fontWeight: 500, letterSpacing: em(20, -0.01) }}>
              <span style={{ ...label(12), marginBottom: 6 }}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
