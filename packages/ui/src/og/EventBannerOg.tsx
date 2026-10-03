import { OG_FONT_FAMILY, OG_SIZE } from "./EventCoverOg";

/**
 * Link-preview layouts built from an uploaded cover (Satori-safe, 1200×630). Link previews crop to a centred square
 * on WhatsApp/iMessage/LinkedIn/X thumbnails, so the key text stays inside the central 630×630 safe area.
 * - `EventBannerOg`: the wide banner fills the top band (the caller cover-fits it to `width × bannerHeight`), and a
 *   white band below carries the title (max 2 lines, ellipsis), the date · time · venue line and the Didit logo.
 * - `EventSquareCoverOg`: no banner — the square cover is scaled to fit (never cropped) in the centre, over the
 *   theme photo of the default design.
 */
const FG = "#1A1A1A";
const MUTED = "#6E6E73";
const BRAND = "#2567FF";
const BG = "#FEFEFE";
const LOGO_RATIO = 720 / 249;

/** Height of the banner band for a banner of `width × height` (its natural ratio at 1200 wide, kept in 300–400). */
export function ogBannerHeight(width: number, height: number): number {
  if (!width || !height) return 360;
  return Math.min(400, Math.max(300, Math.round((OG_SIZE.width * height) / width)));
}

/** Rough Inter 500 advance per character in em, enough to wrap a title before Satori lays it out. */
const advance = (c: string) =>
  /[iljI.,:;'!|]/.test(c) ? 0.28 : /[ftr\s()\-]/.test(c) ? 0.36 : /[mwMW@]/.test(c) ? 0.86 : /[A-Z0-9&]/.test(c) ? 0.66 : 0.56;
const measure = (s: string, size: number) => [...s].reduce((w, c) => w + advance(c) * size, 0);

export type OgWord = { w: string; accent: boolean };

/** Greedy word wrap into at most `lines` lines of `width` px at `size` px; the last kept line ends with "…" when cut. */
export function clampOgTitle(words: OgWord[], width: number, size: number, lines = 2): OgWord[][] {
  const out: OgWord[][] = [];
  let line: OgWord[] = [];
  const text = (l: OgWord[]) => l.map((x) => x.w).join(" ");
  for (let i = 0; i < words.length; i++) {
    const next = [...line, words[i]!];
    if (!line.length || measure(text(next), size) <= width) {
      line = next;
      continue;
    }
    out.push(line);
    line = [words[i]!];
    if (out.length === lines) {
      // Out of lines: cut the last kept line and close it with an ellipsis.
      const last = out[lines - 1]!;
      let tail = last[last.length - 1]!;
      while (measure(`${text(last.slice(0, -1).concat(tail))}…`, size) > width && tail.w.length > 1) tail = { ...tail, w: tail.w.slice(0, -1) };
      out[lines - 1] = [...last.slice(0, -1), { ...tail, w: `${tail.w.replace(/[\s,.;:–-]+$/, "")}…` }];
      return out;
    }
  }
  if (line.length) out.push(line);
  return out;
}

export function ogTitleWords(title: string, accent?: string): OgWord[] {
  return [
    ...title.split(/\s+/).filter(Boolean).map((w) => ({ w, accent: false })),
    ...(accent ?? "").split(/\s+/).filter(Boolean).map((w) => ({ w, accent: true })),
  ];
}

export interface EventBannerOgProps {
  /** data: URI of the banner, already cover-fitted to 1200 × `bannerHeight`. */
  banner: string;
  bannerHeight: number;
  title: string;
  accent?: string;
  /** "Thu 8 Oct · 19:00 CEST · Pier01, Barcelona" */
  meta: string;
  /** data: URI of assets/didit-horizontal-color.png. */
  logo: string;
}

const TITLE_SIZE = 44;
const SAFE = 600; // inside the central 630×630 square, with a little air

export function EventBannerOg({ banner, bannerHeight, title, accent, meta, logo }: EventBannerOgProps) {
  const { width: W, height: H } = OG_SIZE;
  const lines = clampOgTitle(ogTitleWords(title, accent), SAFE, TITLE_SIZE);
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: BG, color: FG, fontFamily: OG_FONT_FAMILY }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={banner} width={W} height={bannerHeight} alt="" style={{ width: W, height: bannerHeight, objectFit: "cover" }} />
      <div style={{ display: "flex", width: W, height: 4, background: BRAND }} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 300px" }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "center", maxWidth: SAFE, whiteSpace: "nowrap", overflow: "hidden", fontSize: TITLE_SIZE, fontWeight: 500, lineHeight: 1.1, letterSpacing: -1.6 }}>
            {line.map((word, j) => (
              <span key={j} style={{ color: word.accent ? BRAND : FG, marginRight: j === line.length - 1 ? 0 : 12 }}>
                {word.w}
              </span>
            ))}
          </div>
        ))}
        {meta ? (
          <div style={{ display: "flex", maxWidth: SAFE, marginTop: 14, fontSize: 20, fontWeight: 500, letterSpacing: -0.2, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</div>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} height={24} width={Math.round(24 * LOGO_RATIO)} alt="" style={{ marginTop: 18 }} />
      </div>
    </div>
  );
}

export interface EventSquareCoverOgProps {
  /** data: URI of the main cover, already contained in `coverSize × coverSize`. */
  cover: string;
  coverSize: number;
  /** data: URI of og/bg-sky.jpg or og/bg-aqua.jpg. */
  photo: string;
  aqua?: boolean;
  date: string;
  doors: string;
  venue: string;
  logo: string;
}

export function EventSquareCoverOg({ cover, coverSize, photo, aqua, date, doors, venue, logo }: EventSquareCoverOgProps) {
  const { width: W, height: H } = OG_SIZE;
  const left = (W - coverSize) / 2;
  const top = (H - coverSize) / 2;
  const side = left - 64 - 24;
  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative", overflow: "hidden", background: BG, color: FG, fontFamily: OG_FONT_FAMILY }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo} width={W} height={H} alt="" style={{ position: "absolute", left: 0, top: 0, width: W, height: H, objectFit: "cover", ...(aqua ? { transform: "scaleX(-1)" } : null) }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex", background: "rgba(254,254,254,.55)" }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cover}
        width={coverSize}
        height={coverSize}
        alt=""
        style={{ position: "absolute", left, top, width: coverSize, height: coverSize, objectFit: "contain", borderRadius: 20, boxShadow: "0 18px 48px rgba(26,26,26,.18)" }}
      />
      <div style={{ position: "absolute", left: 64, top: 64, bottom: 64, width: side, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} height={28} width={Math.round(28 * LOGO_RATIO)} alt="" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          {[
            ["DATE", date],
            ["DOORS", doors],
            ["VENUE", venue],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", marginTop: 16, fontSize: 18, fontWeight: 500, letterSpacing: -0.2 }}>
                <span style={{ fontSize: 11, letterSpacing: 1.5, color: MUTED, marginBottom: 4 }}>{k}</span>
                <span>{v}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
