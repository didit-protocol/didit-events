/**
 * The public calendar profile (P-03 header): name, tagline, bio, cover and logo images, links. One row per calendar
 * (`calendar_profiles`, key 'default'); no row means the app renders its built-in copy and assets. Images are stored
 * as bytea next to a content type and a version the public route puts in the URL, so every upload busts the cache.
 */
import { getDb, type Db } from "./db/index.ts";
import { queryable } from "./db/tx.ts";

export const CALENDAR_KEY = "default";
export const CALENDAR_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type CalendarImageType = (typeof CALENDAR_IMAGE_TYPES)[number];
export type CalendarImageKind = "cover" | "logo";
/** Raw upload limit (the browser re-encodes first, so real uploads are far smaller). */
export const CALENDAR_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CALENDAR_LIMITS = { name: 80, tagline: 120, description: 600, url: 300 } as const;

export interface CalendarProfileRow {
  name: string;
  tagline: string;
  description: string;
  coverType: CalendarImageType | null;
  coverVersion: number;
  logoType: CalendarImageType | null;
  logoVersion: number;
  websiteUrl: string | null;
  xUrl: string | null;
  linkedinUrl: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CalendarTextInput {
  name: string;
  tagline: string;
  description: string;
  websiteUrl: string | null;
  xUrl: string | null;
  linkedinUrl: string | null;
}

export class CalendarImageError extends Error {
  constructor(readonly code: "NotAnImage" | "TooLarge" | "BadDimensions" | "Unreadable") { super(code); this.name = "CalendarImageError"; }
}

export interface ImageInfo { type: CalendarImageType; width: number; height: number }

const u16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** Reads the type and pixel size from the file header (magic bytes, never the claimed MIME type). */
export function sniffImage(b: Uint8Array): ImageInfo | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") return { type: "image/png", width: u32(b, 16), height: u32(b, 20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let pos = 2;
    while (pos + 9 < b.length) {
      if (b[pos] !== 0xff) return null;
      const marker = b[pos + 1]!;
      if (marker === 0xff) { pos++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
      if (marker === 0xda || marker === 0xd9) return null;
      const size = u16(b, pos + 2);
      if (size < 2) return null;
      // SOF0…SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { type: "image/jpeg", height: u16(b, pos + 5), width: u16(b, pos + 7) };
      pos += 2 + size;
    }
    return null;
  }
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") return { type: "image/webp", width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
    if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { type: "image/webp", width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/** Minimum decoded size per slot: a banner must at least fill a phone width, a logo a 64 px tile. */
const MIN: Record<CalendarImageKind, { width: number; height: number }> = { cover: { width: 600, height: 120 }, logo: { width: 64, height: 64 } };
const MAX_SIDE = 8000;

/** Validates an upload and returns its type (throws CalendarImageError). */
export function validateCalendarImage(kind: CalendarImageKind, bytes: Uint8Array): ImageInfo {
  if (bytes.length > CALENDAR_IMAGE_MAX_BYTES) throw new CalendarImageError("TooLarge");
  const info = sniffImage(bytes);
  if (!info) throw new CalendarImageError("NotAnImage");
  const min = MIN[kind];
  if (info.width < min.width || info.height < min.height || info.width > MAX_SIDE || info.height > MAX_SIDE) throw new CalendarImageError("BadDimensions");
  // A logo is shown in a square tile: refuse panoramas that would crop to nothing.
  if (kind === "logo" && Math.max(info.width, info.height) > 3 * Math.min(info.width, info.height)) throw new CalendarImageError("BadDimensions");
  return info;
}

/**
 * Drops EXIF/XMP/ICC comments (JPEG APP1…APP15 + COM, PNG text/eXIf chunks) so camera metadata is never served.
 * Fails closed: a segment/chunk chain that is truncated or never reaches SOS/IEND throws `Unreadable` rather than
 * returning the original bytes with their metadata.
 */
export function stripMetadata(bytes: Uint8Array, type: CalendarImageType): Uint8Array {
  if (type === "image/jpeg") {
    const parts: Uint8Array[] = [bytes.subarray(0, 2)];
    let pos = 2;
    for (;;) {
      if (pos + 4 > bytes.length || bytes[pos] !== 0xff) throw new CalendarImageError("Unreadable");
      const marker = bytes[pos + 1]!;
      if (marker === 0xda) break;
      const size = u16(bytes, pos + 2), end = pos + 2 + size;
      if (size < 2 || end > bytes.length) throw new CalendarImageError("Unreadable");
      if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) parts.push(bytes.subarray(pos, end));
      pos = end;
    }
    parts.push(bytes.subarray(pos));
    return concat(parts);
  }
  if (type === "image/png") {
    const parts: Uint8Array[] = [bytes.subarray(0, 8)];
    let pos = 8;
    for (;;) {
      if (pos + 12 > bytes.length) throw new CalendarImageError("Unreadable");
      const len = u32(bytes, pos), end = pos + 12 + len, name = ascii(bytes, pos + 4, 4);
      if (end > bytes.length) throw new CalendarImageError("Unreadable");
      if (!["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "iCCP"].includes(name)) parts.push(bytes.subarray(pos, end));
      pos = end;
      if (name === "IEND") break;
    }
    return concat(parts);
  }
  if (type === "image/webp") {
    const input = Buffer.from(bytes);
    if (input.length < 12 || input.toString("ascii", 0, 4) !== "RIFF" || input.toString("ascii", 8, 12) !== "WEBP" || input.readUInt32LE(4) + 8 !== input.length) throw new CalendarImageError("Unreadable");
    const parts: Uint8Array[] = [input.subarray(0, 12)];
    let pos = 12, image = false;
    while (pos < input.length) {
      if (pos + 8 > input.length) throw new CalendarImageError("Unreadable");
      const name = input.toString("ascii", pos, pos + 4), size = input.readUInt32LE(pos + 4), end = pos + 8 + size + (size % 2);
      if (end > input.length) throw new CalendarImageError("Unreadable");
      if (["VP8 ", "VP8L", "ANMF"].includes(name)) image = true;
      if (!["EXIF", "XMP ", "ICCP"].includes(name)) {
        const chunk = Buffer.from(input.subarray(pos, end));
        if (name === "VP8X") {
          if (size !== 10) throw new CalendarImageError("Unreadable");
          chunk[8] = chunk[8]! & ~0x2c; // Clear ICC, EXIF and XMP feature flags.
        }
        parts.push(chunk);
      }
      pos = end;
    }
    if (!image) throw new CalendarImageError("Unreadable");
    const clean = Buffer.from(concat(parts));
    clean.writeUInt32LE(clean.length - 8, 4);
    return new Uint8Array(clean);
  }
  throw new CalendarImageError("Unreadable");
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** `kind` is interpolated into SQL column names: accept only the two known slots at runtime too. */
function slot(kind: CalendarImageKind): CalendarImageKind {
  if (kind !== "cover" && kind !== "logo") throw new Error("InvalidCalendarImageKind");
  return kind;
}

const COLUMNS = "name,tagline,description,cover_type,cover_version,logo_type,logo_version,website_url,x_url,linkedin_url,updated_at,updated_by";
type RawRow = { name: string; tagline: string; description: string; cover_type: CalendarImageType | null; cover_version: number; logo_type: CalendarImageType | null; logo_version: number; website_url: string | null; x_url: string | null; linkedin_url: string | null; updated_at: Date | string; updated_by: string | null };
const toRow = (r: RawRow): CalendarProfileRow => ({ name: r.name, tagline: r.tagline, description: r.description, coverType: r.cover_type, coverVersion: Number(r.cover_version), logoType: r.logo_type, logoVersion: Number(r.logo_version),
  websiteUrl: r.website_url, xUrl: r.x_url, linkedinUrl: r.linkedin_url, updatedAt: new Date(r.updated_at), updatedBy: r.updated_by });

/** The stored profile, or null when staff never saved one (the public page then shows the built-in header). */
export async function getCalendarProfile(handle: Db = getDb()): Promise<CalendarProfileRow | null> {
  const [row] = await queryable(handle).query<RawRow>(`select ${COLUMNS} from calendar_profiles where key=$1`, [CALENDAR_KEY]);
  return row ? toRow(row) : null;
}

/** Upserts the text fields and links; images are untouched. */
export async function saveCalendarText(actor: string, input: CalendarTextInput, handle: Db = getDb()): Promise<CalendarProfileRow> {
  const [row] = await queryable(handle).query<RawRow>(
    `insert into calendar_profiles (key,name,tagline,description,website_url,x_url,linkedin_url,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (key) do update set name=excluded.name,tagline=excluded.tagline,description=excluded.description,website_url=excluded.website_url,x_url=excluded.x_url,linkedin_url=excluded.linkedin_url,updated_by=excluded.updated_by,updated_at=clock_timestamp()
     returning ${COLUMNS}`,
    [CALENDAR_KEY, input.name, input.tagline, input.description, input.websiteUrl, input.xUrl, input.linkedinUrl, actor]);
  return toRow(row!);
}

/**
 * Stores a validated image in its slot and bumps the slot version. With no row yet, the row is created from
 * `seed` (the built-in copy) so an image can be set before any text is saved.
 */
export async function setCalendarImage(actor: string, kind: CalendarImageKind, bytes: Uint8Array, seed: Pick<CalendarTextInput, "name" | "tagline" | "description">, handle: Db = getDb()): Promise<CalendarProfileRow> {
  kind = slot(kind);
  const info = validateCalendarImage(kind, bytes);
  const clean = stripMetadata(bytes, info.type);
  const [row] = await queryable(handle).query<RawRow>(
    `insert into calendar_profiles (key,name,tagline,description,${kind},${kind}_type,${kind}_version,updated_by) values ($1,$2,$3,$4,$5,$6,1,$7)
     on conflict (key) do update set ${kind}=excluded.${kind},${kind}_type=excluded.${kind}_type,${kind}_version=calendar_profiles.${kind}_version+1,updated_by=excluded.updated_by,updated_at=clock_timestamp()
     returning ${COLUMNS}`,
    [CALENDAR_KEY, seed.name, seed.tagline, seed.description, clean, info.type, actor]);
  return toRow(row!);
}

/** Clears an image slot (the public page falls back to the built-in asset). Version still moves forward. */
export async function removeCalendarImage(actor: string, kind: CalendarImageKind, handle: Db = getDb()): Promise<CalendarProfileRow | null> {
  kind = slot(kind);
  const [row] = await queryable(handle).query<RawRow>(
    `update calendar_profiles set ${kind}=null,${kind}_type=null,${kind}_version=${kind}_version+1,updated_by=$2,updated_at=clock_timestamp() where key=$1 returning ${COLUMNS}`, [CALENDAR_KEY, actor]);
  return row ? toRow(row) : null;
}

/** The stored bytes of one slot for the public image route. */
export async function getCalendarImage(kind: CalendarImageKind, handle: Db = getDb()): Promise<{ bytes: Uint8Array; type: CalendarImageType; version: number } | null> {
  kind = slot(kind);
  const [row] = await queryable(handle).query<{ bytes: Uint8Array | null; type: CalendarImageType | null; version: number }>(
    `select ${kind} as bytes,${kind}_type as type,${kind}_version as version from calendar_profiles where key=$1`, [CALENDAR_KEY]);
  return row?.bytes && row.type ? { bytes: new Uint8Array(row.bytes), type: row.type, version: Number(row.version) } : null;
}
