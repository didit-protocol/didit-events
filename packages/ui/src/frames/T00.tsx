import type { CSSProperties } from "react";
import styles from "./frame.module.css";

/* Values mirror the T-00 data in design/00 Foundations.dc.html. */
const swatch = (bg: string): CSSProperties => ({
  height: 72,
  borderRadius: 12,
  background: bg,
  border: "1px solid var(--border)",
  display: "flex",
  alignItems: "flex-end",
  padding: 8,
  boxSizing: "border-box",
});

const NEUTRALS: Array<[string, string, string]> = [
  ["white", "#FEFEFE", "Page background"],
  ["ultra-soft", "#F8F8F8", "Zebra rows, soft cards"],
  ["soft", "#F4F4F6", "Card and fill surface"],
  ["mid-soft", "#C4C7C7", "Strong fill"],
  ["mid", "#9DA1A1", "Borders, dividers"],
  ["mid-high", "#6E6E73", "Tertiary text, icons"],
  ["high", "#4B5058", "Secondary text"],
  ["black", "#1A1A1A", "Body text, primary button"],
  ["kiosk-bg", "#0D0D0D", "Kiosk canvas"],
];

const BRAND: Array<[string, string, string, string, string]> = [
  ["brand", "#2567FF", "var(--brand)", "#fff", "One word per headline, links, focus"],
  ["brand-light", "#4D94FF", "var(--brand-light)", "#fff", "Kiosk scan line, hover tints"],
  ["brand-deep", "#07479E", "var(--brand-deep)", "#fff", "Pressed, focus"],
  ["brand-soft", "rgba(37,103,255,.12)", "var(--brand-soft)", "#07479E", "Selected rows, info pills"],
  ["brand-lime", "#ECF86E", "var(--brand-lime)", "#1A1A1A", "Rare, once per screen"],
  ["feature", "#9B26FF", "var(--feature-soft)", "#6600BD", "In review, awaiting"],
  ["success", "#41D97F · #E7FAF0 · #0E7A3D", "var(--success-bg)", "#0E7A3D", "Verified, Checked in"],
  ["warning", "#FF7426 · #FFEEDF · #B3490D", "var(--warning-bg)", "#B3490D", "Pending, Link sent, Missing"],
  ["danger", "#FF4141 · #FFE6E6 · #C42121", "var(--danger-bg)", "#C42121", "Declined, Revoked, errors"],
];

const TYPE: Array<[string, string, string, string, string, CSSProperties?]> = [
  ["Kiosk hero", "500 · 140/1.0 · −3.5%", "500 64px/1", "-.035em", "Maria García"],
  ["Kiosk headline", "500 · 96/1.05 · −3%", "500 48px/1.05", "-.03em", "Welcome,"],
  ["Kiosk sub", "400 · 40/1.3", "400 24px/1.3", "-.01em", "Look at the screen to check in"],
  ["Display", "500 · 48/1.05 · −3.5%", "500 40px/1.05", "-.035em", "You’re verified"],
  ["Headline", "500 · 28/1.2 · −2%", "500 28px/1.2", "-.02em", "Barcelona Office Opening"],
  ["Title", "500 · 17/1.3 · −1%", "500 17px/1.3", "-.01em", "Guest details"],
  ["Body", "400 · 14/1.5", "400 14px/1.5", "0", "Staff create an event, accept guests, send links."],
  ["Small", "400 · 13/1.45", "400 13px/1.45", "0", "Registered as Maria Garcia Lopez"],
  ["Eyebrow", "500 · 11 · +8% · UPPER · tnum", "500 11px/normal", ".08em", "LIVE · DOOR 1 · 19:42", { textTransform: "uppercase", color: "#6E6E73", fontFeatureSettings: "'tnum'" }],
  ["Metric", "500 · 36 · −3% · tnum", "500 36px/normal", "-.03em", "98 / 124", { fontFeatureSettings: "'tnum'" }],
];

const RADII: Array<[number, string]> = [
  [6, "Inputs, badges"],
  [12, "Cards, menus"],
  [20, "Panels"],
  [24, "Modals"],
  [999, "Pills"],
];
const SPACING = [4, 6, 8, 12, 16, 24, 32, 40, 48];

const f = (spec: string) => `${spec} var(--font-sans)`;
const tnum: CSSProperties = { fontFeatureSettings: "'tnum'" };

export function T00Tokens() {
  return (
    <div data-screen-label="T-00 Tokens" className={styles.frame}>
      <div className={styles.head}>
        <div className={styles.kicker}>T-00 · Tokens</div>
        <div className={styles.title}>
          Didit Brand v5. <span style={{ color: "var(--brand)" }}>One accent.</span>
        </div>
        <div className={styles.lede}>Every value below is the exact token the Next.js app ships. Admin and guest pages are light; the kiosk runs on #0D0D0D.</div>
      </div>

      <div className={styles.section}>
        <div className={styles.eyebrow}>Neutrals</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(9,1fr)", gap: 12 }}>
          {NEUTRALS.map(([name, hex, use]) => (
            <div key={name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={swatch(hex)} />
              <div style={{ font: f("500 13px/normal") }}>{name}</div>
              <div style={{ font: f("400 12px/normal"), color: "#6E6E73", ...tnum }}>{hex}</div>
              <div style={{ font: f("400 12px/1.4"), color: "#4B5058" }}>{use}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.eyebrow}>Brand and status</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(9,1fr)", gap: 12 }}>
          {BRAND.map(([name, hex, bg, fg, use]) => (
            <div key={name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={swatch(bg)}>
                <span style={{ font: f("500 18px/normal"), color: fg, letterSpacing: "-.02em" }}>Aa</span>
              </div>
              <div style={{ font: f("500 13px/normal") }}>{name}</div>
              <div style={{ font: f("400 12px/1.4"), color: "#6E6E73", ...tnum }}>{hex}</div>
              <div style={{ font: f("400 12px/1.4"), color: "#4B5058" }}>{use}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 56 }}>
        <div className={styles.section}>
          <div className={styles.eyebrow}>Type scale · Inter only</div>
          {TYPE.map(([name, spec, font, ls, sample, extra]) => (
            <div
              key={name}
              style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16, alignItems: "baseline", borderTop: "1px solid var(--border)", paddingTop: 12 }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ font: f("500 13px/normal") }}>{name}</span>
                <span style={{ font: f("400 12px/normal"), color: "#6E6E73", ...tnum }}>{spec}</span>
              </div>
              <div style={{ font: f(font), letterSpacing: ls, color: "#1A1A1A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...extra }}>{sample}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <div className={styles.section}>
            <div className={styles.eyebrow}>Radii</div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {RADII.map(([v, use]) => (
                <div key={v} style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                  <div style={{ width: 64, height: 64, background: "#F4F4F6", border: "1px solid var(--border)", borderRadius: v > 40 ? 999 : v }} />
                  <div style={{ font: f("500 12px/normal"), ...tnum }}>{v}px</div>
                  <div style={{ font: f("400 11px/normal"), color: "#6E6E73" }}>{use}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className={styles.eyebrow}>Spacing · 4px grid</div>
            {SPACING.map((v) => (
              <div key={v} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 28, font: f("500 12px/normal"), ...tnum }}>{v}</span>
                <div style={{ height: 12, width: v * 4, background: "var(--brand-soft)", borderLeft: "2px solid var(--brand)" }} />
              </div>
            ))}
          </div>
          <div className={styles.section}>
            <div className={styles.eyebrow}>Shadows · borders · focus</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 24, padding: 16, background: "#F8F8F8", borderRadius: 12 }}>
              {(
                [
                  ["Raised", "0 4 12 rgba(120,120,128,.20)", { borderRadius: 12, boxShadow: "var(--shadow-raised)" }],
                  ["Modal", "0 24 48 −12 rgba(120,120,128,.20)", { borderRadius: 24, boxShadow: "var(--shadow-modal)" }],
                  ["Border", "1px #9DA1A1 @ 40%", { borderRadius: 12, border: "1px solid var(--border)" }],
                  ["Focus ring", "2px #2567FF, 2px offset", { borderRadius: 12, outline: "2px solid var(--brand)", outlineOffset: 2 }],
                ] as Array<[string, string, CSSProperties]>
              ).map(([name, spec, s]) => (
                <div key={name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ height: 64, background: "#FEFEFE", ...s }} />
                  <span style={{ font: f("500 12px/normal") }}>{name}</span>
                  <span style={{ font: f("400 11px/normal"), color: "#6E6E73" }}>{spec}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className={styles.eyebrow}>Motion</div>
            <div style={{ font: f("400 13px/1.6"), color: "#4B5058" }}>
              UI 150–250ms · enter cubic-bezier(.16,1,.3,1) · leave cubic-bezier(.7,0,.84,0) · kiosk results 400–700ms · reduced motion: crossfade only.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
