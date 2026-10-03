import type { CSSProperties } from "react";
import bgAqua from "../assets/bg-aqua.webp";
import bgSky from "../assets/bg-sky.webp";
import color from "../assets/didit-horizontal-color.png";
import { assetSrc } from "../Logo";

export type CoverFormat = "square" | "og" | "story";
export type CoverTheme = "sky" | "aqua";

export const COVER_SIZES: Record<CoverFormat, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  og: { w: 1200, h: 630 },
  story: { w: 1080, h: 1920 },
};

export interface EventCoverProps {
  format?: CoverFormat;
  src?: string | null;
  /** Width-limited candidates of `src` with their `sizes`, so a phone does not fetch the full-size upload. */
  srcSet?: string;
  sizes?: string;
  alt?: string;
  theme?: CoverTheme;
  title?: string;
  /** Trailing part of the title set in brand blue (one accent per headline). */
  accent?: string;
  date?: string;
  doors?: string;
  venue?: string;
  eyebrow?: string;
  tag?: string;
  panels?: string[];
  /** Scales the fixed-size art (e.g. 0.5 for a preview). */
  scale?: number;
  /** The uploaded cover is the page's largest image: fetch it first. Otherwise it loads lazily. */
  priority?: boolean;
  /** Loads with the page without the high priority: a second copy of a cover another element already fetches first. */
  eager?: boolean;
  className?: string;
}

type Img = string | { src: string };

/**
 * Parametric event cover art (AI Era Cover.dc.html): square 1080², OG 1200×630, story 1080×1920; sky or aqua photo
 * mesh, concentric "face scan" rings and a scan line. Pure inline styles so it also renders inside `next/og`.
 */
export function EventCover({
  src, srcSet, sizes, alt,
  format = "square",
  theme = "sky",
  title = "Building, Raising & Scaling in the",
  accent = "AI Era",
  date = "Thu 8 Oct 2026",
  doors = "18:30 CEST",
  venue = "Didit HQ, Barcelona",
  eyebrow = "AN EVENING FOR FOUNDERS",
  tag = "DIDIT EVENTS · BARCELONA",
  panels = ["How to build AI-native companies", "Raising in SF vs EU"],
  scale,
  priority,
  eager,
  className,
}: EventCoverProps) {
  const og = format === "og";
  const story = format === "story";
  const { w: W, h: H } = COVER_SIZES[format];
  const photo = assetSrc((theme === "aqua" ? bgAqua : bgSky) as Img);
  const fg = "#1A1A1A";
  const sub = "#4B5058";
  const muted = "#6E6E73";
  const line = "rgba(157,161,161,.4)";
  const pad = og ? 64 : story ? 96 : 88;
  const cx = og ? "85%" : story ? "72%" : "84%";
  const cy = og ? "50%" : story ? "21%" : "76%";
  const base = og ? 560 : story ? 900 : 660;
  const sw = base * 0.62 * 0.78;
  const tsize = og ? 72 : story ? 116 : 100;

  const root: CSSProperties = {
    width: W,
    height: H,
    position: "relative",
    overflow: "hidden",
    fontFamily: "var(--font-sans, Inter), sans-serif",
    color: fg,
    background: "#FEFEFE",
    ...(scale ? { transform: `scale(${scale})`, transformOrigin: "0 0" } : null),
  };
  const mesh: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: `linear-gradient(${og ? "90deg" : "160deg"}, rgba(254,254,254,.72) 0%, rgba(254,254,254,.35) 45%, rgba(254,254,254,0) 75%), url(${photo}) center / cover no-repeat`,
    transform: theme === "aqua" ? "scaleX(-1)" : "none",
  };
  const rings = [1, 0.8, 0.62, 0.46, 0.3].map<CSSProperties>((k, i) => ({
    position: "absolute",
    left: cx,
    top: cy,
    width: base * k * 0.78,
    height: base * k,
    transform: "translate(-50%,-50%)",
    borderRadius: "50%",
    border: i === 2 ? "3px solid #2567FF" : "1.5px solid rgba(254,254,254,.6)",
    boxShadow: i === 2 ? "0 0 48px rgba(37,103,255,.18)" : "none",
    opacity: i === 2 ? 0.9 : 1,
  }));
  const label = (size: number): CSSProperties => ({ font: `500 ${size}px/normal var(--font-sans, Inter), sans-serif`, letterSpacing: ".14em", color: muted });

  if (src) return <div style={root} className={className}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} srcSet={srcSet} sizes={srcSet ? sizes : undefined} alt={alt ?? title} width={W} height={H} decoding="async" loading={priority || eager ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} style={{width:"100%",height:"100%",objectFit:"cover"}} />
  </div>;
  return (
    <div style={root} className={className} role="img" aria-label={`${title} ${accent}`.trim() + ` — ${date}, ${venue}`}>
      <div style={mesh} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {rings.map((r, i) => (
          <div key={i} style={r} />
        ))}
        <div
          style={{
            position: "absolute",
            left: cx,
            top: cy,
            width: sw * 0.86,
            height: 3,
            transform: "translate(-50%, -50%)",
            background: "#4D94FF",
            borderRadius: 999,
            boxShadow: "0 0 28px 8px rgba(77,148,255,.35)",
            opacity: 0.7,
          }}
        />
      </div>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, padding: pad, boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetSrc(color as Img)} style={{ height: og ? 34 : 44 }} alt="" />
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: og ? 36 : 44,
              padding: og ? "0 16px" : "0 20px",
              borderRadius: 999,
              background: "rgba(254,254,254,.75)",
              border: `1px solid ${line}`,
              font: `500 ${og ? 13 : 16}px/normal var(--font-sans, Inter), sans-serif`,
              letterSpacing: ".12em",
              color: sub,
              boxSizing: "border-box",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2567FF" }} />
            {tag}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: og ? 22 : 36, maxWidth: og ? 740 : story ? 900 : 800, marginTop: story ? 520 : 0 }}>
          <span style={{ ...label(og ? 14 : 18), color: "#2567FF" }}>{eyebrow}</span>
          <div style={{ font: `500 ${tsize}px/1 var(--font-sans, Inter), sans-serif`, letterSpacing: "-.045em", textWrap: "balance" }}>
            {title}
            {accent ? (
              <>
                {" "}
                <span style={{ color: "#2567FF" }}>{accent}</span>
              </>
            ) : null}
          </div>
          {panels.length ? (
            <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${line}`, maxWidth: og ? 620 : story ? 760 : 640 }}>
              {panels.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: og ? 18 : 24,
                    padding: og ? "12px 0" : "20px 0",
                    borderBottom: `1px solid ${line}`,
                    font: `500 ${og ? 22 : 32}px/normal var(--font-sans, Inter), sans-serif`,
                    letterSpacing: "-.02em",
                  }}
                >
                  <span style={{ ...label(og ? 14 : 18), letterSpacing: ".12em", fontFeatureSettings: "'tnum'", width: og ? 28 : 36 }}>{String(i + 1).padStart(2, "0")}</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: og ? 48 : 64, alignItems: "flex-end" }}>
          {[
            ["DATE", date],
            ["DOORS", doors],
            ["VENUE", venue],
          ].map(([k, v]) => (
            <div
              key={k}
              style={{ display: "flex", flexDirection: "column", gap: 6, font: `500 ${og ? 20 : 28}px/normal var(--font-sans, Inter), sans-serif`, letterSpacing: "-.01em", fontFeatureSettings: "'tnum'" }}
            >
              <span style={label(og ? 12 : 15)}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
