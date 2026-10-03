import { renderSafeMarkdown } from "../content/markdown.ts";
// The one email layout every template renders through. A template builds an `EmailDoc` (content only); this file
// turns it into table-based, inline-CSS HTML (600px card, Outlook-safe: no flex/grid, bgcolor fallbacks, solid
// colours instead of rgba) and a plain-text alternative. Measurements follow the design frames:
//   variant "event"   = design/04 M-01…M-16 (card padding 36/44/32, gap 22, headline 32)
//   variant "account" = design/05 M-17…M-22 (same card; meta rows 13px, 100px labels)
//   variant "guest"   = design/02 E-01…E-03 (card padding 40/44, gap 24, headline 34, 28 on mobile)
import { EMAIL_FONT,EMAIL_RADII as R,EMAIL_TOKENS as T } from "./tokens.ts";

export type EmailVariant = "event" | "account" | "guest";

/** Button icons: 40×40 PNGs (shown at 20px) in `apps/events/public/email-icons`, never SVG or icon fonts. */
export type EmailIcon = "ticket" | "google-calendar" | "apple";

export interface EmailLink {
  label: string;
  href: string;
  icon?: EmailIcon;
}

/** Alt text per icon (shown when images are off). */
const ICON_ALT: Record<EmailIcon, string> = { ticket: "Ticket", "google-calendar": "Google Calendar", apple: "Apple" };

export type RowTone = "default" | "success" | "struck" | "strong";

export interface EmailRow {
  k: string;
  v: string;
  tone?: RowTone;
}

export type EmailBlock =
  | { kind: "code"; code: string; note: string }
  | { kind: "rows"; rows: EmailRow[]; labelWidth: 72 | 80 | 100; size: "md" | "sm" }
  | { kind: "steps"; items: string[] }
  /** `sep` (event agendas): "19:10–20:00 · label"; without it the time and label are set apart by space only. */
  | { kind: "agenda"; title: string; items: { t: string; l: string }[]; sep?: string }
  | { kind: "buttons"; primary: EmailLink; secondary?: EmailLink }
  /** A titled row of two secondary buttons, 2-up on desktop and stacked full width on mobile ("Add to calendar"). */
  | { kind: "buttonPair"; title: string; links: [EmailLink, EmailLink] }
  /** A quiet inline text link for actions that must not look like a button ("Can’t make it? Cancel your place"). */
  | { kind: "textLink"; lead: string; link: EmailLink }
  | { kind: "quote"; text: string }
  | { kind: "note"; text: string }
  | { kind: "markdown"; source: string }
  /**
   * A person card (host emails): photo or initials, name, a verified mark and short lines under the name. `photoUrl`
   * is a `cid:` reference to an inline attachment (guest photos are never public) or an absolute URL.
   */
  | { kind: "person"; name: string; initials: string; photoUrl?: string | null; mark?: string; lines: string[] }
  /** A bordered list of people (host digest): 48px photo or initials, a label (time) and one line each. */
  | { kind: "people"; items: { k: string; name: string; initials: string; photoUrl?: string | null; line: string }[]; more?: string }
  /** Question and answer pairs (host emails): the question in grey, the answer below it. */
  | { kind: "qa"; title: string; items: { q: string; a: string }[] }
  /** A bordered checklist (M-29 profile reminder): a green check when done, an empty circle when still to do. */
  | { kind: "checklist"; title: string; items: { label: string; done: boolean }[] };

export type EmailHero =
  /**
   * The event banner (else its OG cover, V-01 1200×630), inset 20px with the event page cover radius. `size` is the
   * source size when known (OG cover, theme art): the hero then carries a matching height attribute for Outlook.
   */
  | { kind: "cover"; src: string; alt: string; size?: { width: number; height: number } }
  /** A 160px photo band with the event title (design/05 M-19). `accent` is the trailing words shown in brand-deep. */
  | { kind: "band"; src: string; title: string; accent?: string };

export interface EmailDoc {
  variant: EmailVariant;
  subject: string;
  preheader: string;
  /** Absolute (or, in previews, root-relative) URL of the email asset folder: logo, fonts, photos. */
  assetsUrl: string;
  /** The folder the web font is read from; defaults to `assetsUrl`. */
  fontAssetsUrl?: string;
  hero?: EmailHero;
  eyebrow: string;
  /** "muted" is the grey eyebrow of mail sent by Didit itself (M-04). */
  eyebrowTone?: "brand" | "muted";
  headline: string;
  body: string;
  blocks: EmailBlock[];
  footer: { legal: string; link: EmailLink };
}

/** Subjects longer than this are cut at a word boundary (inbox lists show about 70 characters). */
export const SUBJECT_MAX = 70;

/** "A long subject that keeps going…": at most SUBJECT_MAX characters, never cut mid-word when a space is near. */
export function fitSubject(subject: string): string {
  const s = subject.replace(/\s+/g, " ").trim();
  if (s.length <= SUBJECT_MAX) return s;
  const cut = s.slice(0, SUBJECT_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > SUBJECT_MAX * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:·–—-]+$/, "")}…`;
}

/** Collapses the double spaces an empty optional sentence leaves behind ("Doors open.  Check in…"). */
const tidy = (text: string) => text.replace(/[ \t]{2,}/g, " ").replace(/ +([.,])/g, "$1").trim();

/**
 * An optional block with nothing in it (an event without an agenda, a host request without answers, an empty note)
 * never renders: no empty "AGENDA" box, in HTML or text.
 */
export function isEmptyBlock(b: EmailBlock): boolean {
  const blank = (t: string | undefined | null) => !t || !t.trim();
  switch (b.kind) {
    case "rows": return !b.rows.some((r) => !blank(r.v));
    case "steps": return !b.items.some((i) => !blank(i));
    case "agenda": return !b.items.some((i) => !blank(i.l));
    case "qa": return !b.items.some((i) => !blank(i.a));
    case "checklist": return !b.items.some((i) => !blank(i.label));
    case "quote":
    case "note": return blank(b.text);
    case "markdown": return blank(b.source);
    case "code": return blank(b.code);
    case "person": return blank(b.name);
    case "people": return !b.items.some((i) => !blank(i.name));
    case "buttons": return blank(b.primary.href) || blank(b.primary.label);
    case "buttonPair": return b.links.some((l) => blank(l.href));
    case "textLink": return blank(b.link.href);
  }
}

/** The blocks an email shows, with empty ones and their empty entries removed. */
export function visibleBlocks(blocks: EmailBlock[]): EmailBlock[] {
  return blocks
    .map((b): EmailBlock => {
      switch (b.kind) {
        case "rows": return { ...b, rows: b.rows.filter((r) => r.v.trim()) };
        case "steps": return { ...b, items: b.items.filter((i) => i.trim()) };
        case "agenda": return { ...b, items: b.items.filter((i) => i.l.trim()) };
        case "qa": return { ...b, items: b.items.filter((i) => i.a.trim()) };
        case "checklist": return { ...b, items: b.items.filter((i) => i.label.trim()) };
        case "person": return { ...b, lines: b.lines.filter((l) => l.trim()) };
        case "people": return { ...b, items: b.items.filter((i) => i.name.trim()) };
        default: return b;
      }
    })
    .filter((b) => !isEmptyBlock(b));
}

export const COMPANY_LINE = "Didit Identity Spain, S.L. · Carrer de Pallars 99, 08018 Barcelona";
/** The legal entity and address under every email: EMAIL_FOOTER (one line, up to 300 characters), else the production line. */
export function companyLine(value: string | undefined = process.env.EMAIL_FOOTER): string {
  return value?.replace(/\s+/g, " ").trim().slice(0, 300) || COMPANY_LINE;
}

interface VariantMetrics {
  pad: string;
  gap: number;
  headline: number;
}

const VARIANTS: Record<EmailVariant, VariantMetrics> = {
  event: { pad: "36px 44px 32px", gap: 22, headline: 32 },
  account: { pad: "36px 44px 32px", gap: 22, headline: 32 },
  guest: { pad: "40px 44px", gap: 24, headline: 34 },
};

// ── escaping ────────────────────────────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** HTML-escapes text; newlines become <br>. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c]!).replace(/\r?\n/g, "<br>");
}

/** Only http(s), mailto and root-relative URLs reach an href/src; anything else (javascript:, data:) becomes "#". */
export function safeUrl(url: string): string {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u) || (u.startsWith("/") && !u.startsWith("//"))) return esc(u);
  return "#";
}

/** An inline attachment reference (`cid:applicant-1`): image sources only, never links. */
export const isCid = (url: string) => /^cid:[A-Za-z0-9._-]{1,64}$/.test(url.trim());
const safeImg = (url: string) => (isCid(url) ? url.trim() : safeUrl(url));

/** 48px round avatar: the photo, else the initials on the sky fallback. */
function avatarHtml(name: string, initials: string, photoUrl: string | null | undefined, size: number, fontSize: number): string {
  return photoUrl
    ? `<img src="${safeImg(photoUrl)}" width="${size}" height="${size}" alt="${esc(name)}" style="display:block;width:${size}px;height:${size}px;border-radius:50%;border:0">`
    : `<table ${TABLE}><tr><td align="center" valign="middle" width="${size}" height="${size}" bgcolor="${T.skyFallback}" style="width:${size}px;height:${size}px;border-radius:${size / 2}px;background:${T.skyFallback};text-align:center;vertical-align:middle;${font(500, fontSize, `${size}px`)};color:${T.brandDeep}">${esc(initials)}</td></tr></table>`;
}

// ── style helpers ───────────────────────────────────────────────────────────────────────────────────────────────

/** Longhand font declarations (several clients drop the `font:` shorthand). */
const font = (weight: 400 | 500, size: number, lineHeight: string | number = "normal") =>
  `font-family:${EMAIL_FONT};font-weight:${weight};font-size:${size}px;line-height:${lineHeight}`;

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

const ROW_TONE: Record<RowTone, string> = {
  default: `color:${T.black}`,
  success: `color:${T.successFg};font-weight:500`,
  struck: `color:${T.midHigh};text-decoration:line-through`,
  strong: `color:${T.black};font-weight:500`,
};

// ── blocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One bulletproof pill: the cell carries the colour (bgcolor for Outlook), the link fills it; an optional 20px icon
 * 10px before the label. No negative margins: Gmail drops the whole declaration, which removed the gap on phones.
 */
function pill(l: EmailLink, icons: string, opts: { primary: boolean; height: number; size: number; cls?: string }): string {
  const bg = opts.primary ? T.black : T.chip;
  const fg = opts.primary ? T.white : T.black;
  const icon = l.icon
    ? `<img src="${safeUrl(`${icons}/${l.icon}.png`)}" width="20" height="20" alt="${esc(ICON_ALT[l.icon])}" style="display:inline-block;width:20px;height:20px;border:0;vertical-align:middle;margin:0 10px 0 0">`
    : "";
  return `<td${opts.cls ? ` class="${opts.cls}"` : ""} align="center" bgcolor="${bg}" style="height:${opts.height}px;border-radius:999px;background:${bg};text-align:center"><a href="${safeUrl(l.href)}" target="_blank" style="display:block;border-radius:999px;${font(500, opts.size, `${opts.height}px`)};color:${fg};text-decoration:none">${icon}${esc(l.label)}</a></td>`;
}

function blockHtml(b: EmailBlock, icons: string): string {
  switch (b.kind) {
    case "markdown": return renderSafeMarkdown(b.source,{email:true});
    case "code":
      return (
        `<table ${TABLE}><tr><td bgcolor="${T.soft}" style="padding:14px 22px;border-radius:12px;background:${T.soft};${font(500, 44)};letter-spacing:.18em;font-feature-settings:'tnum';color:${T.black};white-space:nowrap">${esc(b.code)}</td></tr></table>` +
        `<div style="padding-top:8px;${font(400, 13)};color:${T.midHigh}">${esc(b.note)}</div>`
      );
    case "rows": {
      const [size, pad, gap] = b.size === "md" ? [14, "16px 18px", 8] : [13, "14px 18px", 6];
      const rows = b.rows
        .map((r, i) => {
          const top = i === 0 ? 0 : gap;
          return (
            `<tr><td valign="top" width="${b.labelWidth}" style="width:${b.labelWidth}px;padding:${top}px 0 0;vertical-align:top;${font(400, size, 1.45)};color:${T.midHigh}">${esc(r.k)}</td>` +
            `<td valign="top" style="padding:${top}px 0 0 12px;vertical-align:top;${font(400, size, 1.45)};${ROW_TONE[r.tone ?? "default"]}">${esc(r.v)}</td></tr>`
          );
        })
        .join("");
      return (
        `<table ${TABLE} width="100%" style="width:100%;border:1px solid ${T.line};border-radius:12px;border-collapse:separate"><tr><td style="padding:${pad}">` +
        `<table ${TABLE} width="100%" style="width:100%;table-layout:fixed">${rows}</table></td></tr></table>`
      );
    }
    case "steps":
      return b.items
        .map(
          (s, i) =>
            `<div style="${i ? "padding-top:6px;" : ""}${font(400, 15, 1.5)};color:${T.black}"><b style="font-weight:500">${i + 1}.</b> ${esc(s)}</div>`,
        )
        .join("");
    case "agenda":
      return (
        `<table ${TABLE} width="100%" style="width:100%"><tr><td bgcolor="${T.ultraSoft}" style="padding:16px 18px;border-radius:12px;background:${T.ultraSoft}">` +
        `<div style="${font(500, 11)};letter-spacing:.08em;color:${T.midHigh}">${esc(b.title)}</div>` +
        b.items
          .map(
            (a) =>
              `<div style="padding-top:6px;${font(400, 14, 1.5)};color:${T.black}"><b style="font-weight:500;font-feature-settings:'tnum'">${esc(a.t)}</b>${b.sep ? ` ${esc(b.sep)}` : ""} ${esc(a.l)}</div>`,
          )
          .join("") +
        `</td></tr></table>`
      );
    case "buttons": {
      const btn = (l: EmailLink, primary: boolean) => pill(l, icons, { primary, height: 52, size: 16 });
      const cells = b.secondary ? `${btn(b.primary, true)}<td width="8" style="width:8px;font-size:0;line-height:0">&nbsp;</td>${btn(b.secondary, false)}` : btn(b.primary, true);
      return `<table ${TABLE} width="100%" style="width:100%;table-layout:fixed;border-collapse:separate"><tr>${cells}</tr></table>`;
    }
    case "buttonPair": {
      const [a, c] = b.links.map((l) => pill(l, icons, { primary: false, height: 48, size: 15, cls: "em-col" }));
      return (
        `<div style="padding-bottom:10px;${font(500, 11)};letter-spacing:.08em;color:${T.midHigh}">${esc(b.title)}</div>` +
        `<table ${TABLE} width="100%" style="width:100%;table-layout:fixed;border-collapse:separate"><tr>${a}<td class="em-col-gap" width="8" style="width:8px;font-size:0;line-height:0">&nbsp;</td>${c}</tr></table>`
      );
    }
    case "textLink":
      return `<div style="${font(400, 14, 1.6)};color:${T.high}">${esc(b.lead)} <a href="${safeUrl(b.link.href)}" target="_blank" style="color:${T.black};text-decoration:underline">${esc(b.link.label)}</a></div>`;
    case "quote":
      return `<table ${TABLE} width="100%" style="width:100%"><tr><td bgcolor="${T.ultraSoft}" style="padding:14px 18px;border-radius:12px;background:${T.ultraSoft};${font(400, 15, 1.55)};color:${T.black}">${esc(b.text)}</td></tr></table>`;
    case "note":
      return `<div style="${font(400, 14, 1.6)};color:${T.high}">${esc(b.text)}</div>`;
    case "person": {
      const avatar = avatarHtml(b.name, b.initials, b.photoUrl, 48, 18);
      const mark = b.mark ? `<div style="padding-top:2px;${font(500, 13, 1.45)};color:${T.successFg}">&#10003; ${esc(b.mark)}</div>` : "";
      const lines = b.lines.map((l) => `<div style="padding-top:2px;${font(400, 14, 1.45)};color:${T.high}">${esc(l)}</div>`).join("");
      return (
        `<table ${TABLE} width="100%" style="width:100%"><tr><td bgcolor="${T.ultraSoft}" style="padding:16px 18px;border-radius:12px;background:${T.ultraSoft}">` +
        `<table ${TABLE} width="100%" style="width:100%"><tr><td valign="top" width="48" style="width:48px;vertical-align:top">${avatar}</td>` +
        `<td valign="middle" style="padding-left:14px;vertical-align:middle"><div style="${font(500, 18, 1.3)};color:${T.black}">${esc(b.name)}</div>${mark}${lines}</td></tr></table>` +
        `</td></tr></table>`
      );
    }
    case "people": {
      const rows = b.items
        .map((i, n) =>
          `<tr><td valign="middle" width="48" style="width:48px;padding:${n ? 10 : 0}px 0 0;vertical-align:middle">${avatarHtml(i.name, i.initials, i.photoUrl, 48, 16)}</td>` +
          `<td valign="middle" style="padding:${n ? 10 : 0}px 0 0 12px;vertical-align:middle"><div style="${font(500, 14, 1.4)};color:${T.black}">${esc(i.name)}</div>` +
          `<div style="${font(400, 13, 1.45)};color:${T.midHigh}">${esc([i.k, i.line].filter(Boolean).join(" · "))}</div></td></tr>`)
        .join("");
      const more = b.more ? `<div style="padding-top:12px;${font(500, 13, 1.45)};color:${T.black}">${esc(b.more)}</div>` : "";
      return (
        `<table ${TABLE} width="100%" style="width:100%;border:1px solid ${T.line};border-radius:12px;border-collapse:separate"><tr><td style="padding:14px 18px">` +
        `<table ${TABLE} width="100%" style="width:100%">${rows}</table>${more}</td></tr></table>`
      );
    }
    case "qa":
      return (
        `<table ${TABLE} width="100%" style="width:100%;border:1px solid ${T.line};border-radius:12px;border-collapse:separate"><tr><td style="padding:14px 18px">` +
        `<div style="${font(500, 11)};letter-spacing:.08em;color:${T.midHigh}">${esc(b.title)}</div>` +
        b.items
          .map((i) => `<div style="padding-top:10px;${font(400, 13, 1.45)};color:${T.midHigh}">${esc(i.q)}</div><div style="padding-top:2px;${font(400, 14, 1.5)};color:${T.black}">${esc(i.a)}</div>`)
          .join("") +
        `</td></tr></table>`
      );
    case "checklist": {
      // The mark is a table cell, never an image: a 20px circle, filled green with a check when done, else an outline.
      const mark = (done: boolean) => done
        ? `<td align="center" valign="middle" width="20" height="20" bgcolor="${T.successFg}" style="width:20px;height:20px;border-radius:10px;background:${T.successFg};text-align:center;vertical-align:middle;${font(500, 12, "20px")};color:${T.white}">&#10003;</td>`
        : `<td width="16" height="16" style="width:16px;height:16px;border:2px solid ${T.line};border-radius:10px;font-size:0;line-height:0">&nbsp;</td>`;
      const rows = b.items
        .map((i, n) =>
          `<tr><td valign="middle" width="20" style="width:20px;padding:${n ? 10 : 0}px 0 0;vertical-align:middle"><table ${TABLE}><tr>${mark(i.done)}</tr></table></td>` +
          `<td valign="middle" style="padding:${n ? 10 : 0}px 0 0 12px;vertical-align:middle;${font(i.done ? 400 : 500, 15, 1.45)};${i.done ? `color:${T.midHigh}` : `color:${T.black}`}">${esc(i.label)}</td></tr>`)
        .join("");
      return (
        `<table ${TABLE} width="100%" style="width:100%;border:1px solid ${T.line};border-radius:12px;border-collapse:separate"><tr><td style="padding:16px 18px">` +
        `<div style="padding-bottom:12px;${font(500, 11)};letter-spacing:.08em;color:${T.midHigh}">${esc(b.title)}</div>` +
        `<table ${TABLE} width="100%" style="width:100%">${rows}</table></td></tr></table>`
      );
    }
  }
}

const HERO_INSET = 20;

function heroHtml(h: EmailHero): string {
  if (h.kind === "cover") {
    // Inset 20px with the event page cover's corner radius. The banner's aspect varies (about 10:3; 1200×630 for the
    // OG fallback), so only the width is fixed and the height follows. Outlook desktop ignores border-radius and
    // shows square corners, which is acceptable.
    const w = 600 - 2 * HERO_INSET;
    const height = h.size ? ` height="${Math.round((w * h.size.height) / h.size.width)}"` : "";
    return `<tr><td class="em-hero-inset" style="padding:${HERO_INSET}px ${HERO_INSET}px 0;font-size:0;line-height:0"><img src="${safeUrl(h.src)}" width="${w}"${height} alt="${esc(h.alt)}" style="display:block;width:100%;max-width:${600 - 2 * HERO_INSET}px;height:auto;border:0;border-radius:${R.cover}px"></td></tr>`;
  }
  const title = h.accent && h.title.endsWith(h.accent) ? h.title.slice(0, -h.accent.length) : h.title;
  const accent = h.accent && h.title.endsWith(h.accent) ? `<span style="color:${T.brandDeep}">${esc(h.accent)}</span>` : "";
  // Bulletproof background: the HTML `background` attribute (+ CSS sizing only, never a CSS url()) for clients that
  // show it, the sky fallback colour when images are off, and a VML rect for Outlook desktop, which ignores both.
  const src = safeUrl(h.src);
  return (
    `<tr><td class="em-hero" background="${src}" bgcolor="${T.skyFallback}" valign="bottom" style="padding:0;background-color:${T.skyFallback};background-position:center;background-size:cover;background-repeat:no-repeat;vertical-align:bottom">` +
    `<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:160px"><v:fill type="frame" src="${src}" color="${T.skyFallback}" /><v:textbox inset="0,0,0,0"><![endif]-->` +
    `<div><table ${TABLE} width="100%" style="width:100%"><tr><td class="em-hero-pad" valign="bottom" height="104" style="padding:28px 44px;height:104px;vertical-align:bottom">` +
    `<div style="max-width:420px;${font(500, 26, 1.1)};letter-spacing:-.03em;color:${T.black}">${esc(title)}${accent}</div>` +
    `</td></tr></table></div>` +
    `<!--[if gte mso 9]></v:textbox></v:rect><![endif]-->` +
    `</td></tr>`
  );
}

// ── document ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Invisible padding after the preheader so clients don't pull body text into the inbox preview or the phone
 * notification. No spaces: "&nbsp;&zwnj;" showed as a run of blank spaces followed by the body ("UPDATE …") in Gmail
 * snippets; combining-grapheme-joiner + zwnj pairs are dropped cleanly (measured with Gmail snippets, 2026-10-02).
 */
const PREHEADER_PAD = "&#847;&zwnj;".repeat(150);

/** Button icons live next to the asset folder: `${base}/email` → `${base}/email-icons` (public/email-icons). */
export const iconsUrlOf = (assetsUrl: string) => `${assetsUrl.replace(/\/$/, "").replace(/\/[^/]*$/, "")}/email-icons`;

export function renderHtml(doc: EmailDoc): string {
  const v = VARIANTS[doc.variant];
  const subject = fitSubject(doc.subject);
  const body = tidy(doc.body);
  const assets = doc.assetsUrl.replace(/\/$/, "");
  const eyebrowColor = doc.eyebrowTone === "muted" ? T.midHigh : T.brand;
  const section = (html: string, first = false) => `<tr><td style="padding-top:${first ? 0 : v.gap}px">${html}</td></tr>`;

  const intro =
    `<div style="${font(500, 11)};letter-spacing:.08em;color:${eyebrowColor}">${esc(doc.eyebrow)}</div>` +
    `<h1 class="em-h" style="margin:0;padding-top:12px;${font(500, v.headline, 1.12)};letter-spacing:-.03em;color:${T.black}">${esc(doc.headline)}</h1>` +
    (body ? `<p style="margin:0;padding-top:12px;${font(400, 16, 1.6)};color:${T.high}">${esc(body)}</p>` : "");

  const footer =
    `<div style="padding-top:20px;border-top:1px solid ${T.line};${font(400, 12, 1.6)};color:${T.midHigh}">` +
    `${esc(doc.footer.legal)}<br>${esc(companyLine())} · <a href="${safeUrl(doc.footer.link.href)}" target="_blank" style="color:${T.brand};text-decoration:none">${esc(doc.footer.link.label)}</a></div>`;

  const sections = [
    section(
      `<img src="${safeUrl(`${assets}/didit-logo.png`)}" width="58" height="20" alt="Didit" style="display:block;width:auto;height:20px;border:0">`,
      true,
    ),
    section(intro),
    ...visibleBlocks(doc.blocks).map((b) => section(blockHtml(b, iconsUrlOf(assets)))),
    section(footer),
  ].join("");

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url('${safeUrl(`${(doc.fontAssetsUrl ?? assets).replace(/\/$/, "")}/Inter-Variable.woff2`)}') format('woff2')}
body{margin:0;padding:0;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a{color:${T.brand};text-decoration:none}
@media (min-width:640px){.em-shell{padding:32px 0 !important}}
@media (max-width:480px){.em-card{border-radius:0 !important}.em-pad{padding:28px 20px !important}.em-hero-pad{padding:24px 20px !important}.em-hero-inset{padding:12px 12px 0 !important}.em-col{display:block !important;width:100% !important}.em-col-gap{display:block !important;width:100% !important;height:8px !important}${doc.variant === "guest" ? ".em-h{font-size:28px !important}" : ""}}
</style>
</head>
<body style="margin:0;padding:0;background:${T.soft}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(tidy(doc.preheader))}${PREHEADER_PAD}</div>
<table ${TABLE} width="100%" bgcolor="${T.soft}" style="width:100%;background:${T.soft}"><tr><td align="center" class="em-shell" style="padding:0">
<!--[if mso]><table ${TABLE} width="600"><tr><td><![endif]-->
<table ${TABLE} class="em-card" width="600" bgcolor="${T.white}" style="width:100%;max-width:600px;background:${T.white};border-radius:12px;overflow:hidden;border-collapse:separate;text-align:left">
${doc.hero ? heroHtml(doc.hero) : ""}
<tr><td class="em-pad" style="padding:${v.pad};${font(400, 16)};color:${T.black}">
<table ${TABLE} width="100%" style="width:100%">${sections}</table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
`;
}

function blockText(b: EmailBlock): string {
  switch (b.kind) {
    case "markdown": return b.source;
    case "code":
      return `${b.code}\n${b.note}`;
    case "rows":
      return b.rows.map((r) => `${r.k}: ${r.v}${r.tone === "struck" ? " (changed)" : ""}`).join("\n");
    case "steps":
      return b.items.map((s, i) => `${i + 1}. ${s}`).join("\n");
    case "agenda":
      return [b.title, ...b.items.map((a) => (b.sep ? `${a.t} ${b.sep} ${a.l}` : `${a.t}  ${a.l}`))].join("\n");
    case "buttons":
      return [b.primary, b.secondary].filter((l): l is EmailLink => !!l).map((l) => `${l.label}: ${l.href}`).join("\n");
    case "buttonPair":
      return [b.title, ...b.links.map((l) => `${l.label}: ${l.href}`)].join("\n");
    case "textLink":
      return `${b.lead} ${b.link.label}: ${b.link.href}`;
    case "quote":
    case "note":
      return b.text;
    case "person":
      return [b.name, ...(b.mark ? [b.mark] : []), ...b.lines].join("\n");
    case "people":
      return [...b.items.map((i) => `${i.k}: ${[i.name, i.line].filter(Boolean).join(" · ")}`), ...(b.more ? [`: ${b.more}`] : [])].join("\n");
    case "qa":
      return [b.title, ...b.items.map((i) => `${i.q}\n${i.a}`)].join("\n\n");
    case "checklist":
      return [b.title, ...b.items.map((i) => `[${i.done ? "x" : " "}] ${i.label}`)].join("\n");
  }
}

export function renderText(doc: EmailDoc): string {
  const parts = [
    doc.eyebrow,
    doc.headline,
    tidy(doc.body),
    ...visibleBlocks(doc.blocks).map(blockText),
    `--\n${doc.footer.legal}\n${companyLine()}\n${doc.footer.link.label}: ${doc.footer.link.href}`,
  ];
  return `${parts.filter(Boolean).join("\n\n")}\n`;
}
