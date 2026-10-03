import { createHash,randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { audit,requireEventActor,signal } from "../admission/shared.ts";
import type { CoverUploadResult } from "../contracts/event-model.ts";
import { getDb,type Db } from "../db/index.ts";
import { queryable,withTx } from "../db/tx.ts";
import { coverSchema,type EventCover } from "../domain/event-model.ts";
import type { StaffPrincipal } from "../domain/services.ts";

export class AssetError extends Error {
  constructor(readonly code: "invalid" | "not_found" | "context_changed", readonly status = 422) { super(code); }
}
export const COVER_TRANSPORT_BYTES = 5 * 1024 * 1024;
const coverInput = z.object({ expectedEventVersion: z.number().int().positive(), alt: z.string().trim().min(1).max(200) }).strict();
/**
 * Display widths a stored cover is served at (`&w=`): thumbnails, the phone hero and the hero at 2–3x. The bare URL
 * stays the original upload (up to 4096px): downloads, the OG art and the emails read that one.
 */
export const COVER_WIDTHS = [192, 720, 1080] as const;
export type CoverWidth = (typeof COVER_WIDTHS)[number];
/** `?w=` as sent: an allowed width, else null (the original). Only the allow-list is ever resized or cached. */
export const coverWidth = (raw: string | null | undefined): CoverWidth | null =>
  COVER_WIDTHS.find(w => String(w) === raw) ?? null;
export const eventCoverUrl = (eventId: string, cover: unknown): string | null => {
  const parsed = coverSchema.safeParse(cover);
  return parsed.success && parsed.data.kind === "asset" ? `/api/events/${encodeURIComponent(eventId)}/cover?v=${parsed.data.version}` : null;
};
/** The banner-format cover, when one was uploaded (falls back to the main cover in the UI). */
export const eventWideCoverUrl = (eventId: string, cover: unknown): string | null => {
  const parsed = coverSchema.safeParse(cover);
  return parsed.success && parsed.data.wide ? `/api/events/${encodeURIComponent(eventId)}/cover?v=${parsed.data.wide.version}` : null;
};
export async function canonicalCover(input: Uint8Array) {
  if (!input.byteLength || input.byteLength > COVER_TRANSPORT_BYTES) throw new AssetError("invalid");
  try {
    const image = sharp(input, { limitInputPixels: 12_000_000, failOn: "warning", animated: true });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) !== 1 ||
      !meta.width || !meta.height || meta.width > 4096 || meta.height > 4096 || meta.width * meta.height > 12_000_000)
      throw new AssetError("invalid");
    // Re-encode rather than preserving metadata, including embedded EXIF and ICC profiles.
    const { data, info } = await image.rotate().webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    if (data.byteLength > 2 * 1024 * 1024) throw new AssetError("invalid");
    return { bytes: data, contentType: "image/webp" as const, width: info.width, height: info.height,
      sha256: createHash("sha256").update(data).digest("hex") };
  } catch (error) { if (error instanceof AssetError) throw error; throw new AssetError("invalid"); }
}

export async function uploadEventCover(actor: StaffPrincipal, eventId: string, input: {
  expectedEventVersion: number; alt: string; bytes: Uint8Array; variant?: "main" | "wide";
}, db: Db = getDb()): Promise<CoverUploadResult> {
  const values = coverInput.parse({ expectedEventVersion: input.expectedEventVersion, alt: input.alt });
  z.uuid().parse(eventId);
  await requireEventActor(queryable(db), actor, eventId, "event.edit");
  const image = await canonicalCover(input.bytes);
  return withTx(async tx => {
    await requireEventActor(tx, actor, eventId, "event.edit");
    const [event] = await tx.query<{ edit_version: number; status:string; cover:EventCover }>("select edit_version,status,cover from events where id=$1 for update", [eventId]);
    if (!event) throw new AssetError("not_found", 404);
    if (["ended","cancelled"].includes(event.status)) throw new AssetError("context_changed",409);
    if (event.edit_version !== values.expectedEventVersion) throw new AssetError("context_changed", 409);
    const version = randomUUID(), wide = input.variant === "wide";
    // A wide upload only adds/replaces the banner; a main upload keeps an existing banner.
    const cover: EventCover = wide ? { ...event.cover, wide: { version } }
      : { kind: "asset", version, alt: values.alt, ...(event.cover.privacy ? {privacy:event.cover.privacy} : {}), ...(event.cover.wide ? { wide: event.cover.wide } : {}) };
    await tx.query(`insert into event_assets(event_id,version,bytes,content_type,width,height,sha256)
      values($1,$2,$3,$4,$5,$6,$7)`, [eventId, version, image.bytes, image.contentType, image.width, image.height, image.sha256]);
    const [saved] = await tx.query<{ edit_version: number }>("update events set cover=$2::jsonb,updated_at=clock_timestamp() where id=$1 returning edit_version", [eventId, JSON.stringify(cover)]);
    await audit(tx, eventId, actor.email, "event_cover_uploaded", eventId, { version, sha256: image.sha256 });
    await signal(tx, eventId, "event_updated");
    return { version, url: (wide ? eventWideCoverUrl(eventId, cover) : eventCoverUrl(eventId, cover))!, width: image.width, height: image.height,
      contentType: image.contentType, editVersion: saved!.edit_version };
  }, db);
}

/** Resized covers by `sha256:width`. Versions are immutable, so an entry never goes stale; the oldest is dropped. */
const variants = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
const VARIANT_CACHE_ENTRIES = 96;
function coverVariant(asset: { bytes: Uint8Array; sha256: string }, width: CoverWidth): Promise<Uint8Array<ArrayBuffer>> {
  const key = `${asset.sha256}:${width}`, hit = variants.get(key);
  if (hit) { variants.delete(key); variants.set(key, hit); return hit; }
  const made = sharp(asset.bytes, { limitInputPixels: 12_000_000 })
    .resize({ width, height: width, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
    .then(data => new Uint8Array(data));
  variants.set(key, made);
  made.catch(() => variants.delete(key));
  if (variants.size > VARIANT_CACHE_ENTRIES) variants.delete(variants.keys().next().value!);
  return made;
}

export async function readEventCover(eventId: string, version: string | null, actor?: StaffPrincipal, db: Db = getDb(), width: CoverWidth | null = null): Promise<Response> {
  if (!z.uuid().safeParse(eventId).success || (version !== null && !z.uuid().safeParse(version).success)) return new Response(null, { status: 404 });
  const q = queryable(db);
  const [event] = await q.query<{ cover: unknown; status: string }>("select cover,status from events where id=$1", [eventId]);
  if (!event) return new Response(null, { status: 404 });
  // Everything but a draft has a public page (a cancelled event keeps its page and its row in the guest's My events).
  const publicAsset = ["published", "live", "ended", "cancelled"].includes(event.status);
  if (!publicAsset) {
    if (!actor) return new Response(null, { status: 404 });
    await requireEventActor(q, actor, eventId, "event.view");
  }
  if (!version) {
    const url = eventCoverUrl(eventId, event.cover);
    // Keep the requested size across the redirect to the versioned URL (else ?w=192 would serve the original).
    const sized = url && width !== null ? `${url}${url.includes("?") ? "&" : "?"}w=${width}` : url;
    return sized ? new Response(null, { status: 307, headers: { Location: sized, "Cache-Control": "private, no-store" } }) : new Response(null, { status: 404 });
  }
  const [asset] = await q.query<{ bytes: Uint8Array; content_type: string; sha256: string; width: number; height: number }>(
    "select bytes,content_type,sha256,width,height from event_assets where event_id=$1 and version=$2", [eventId, version]);
  if (!asset) return new Response(null, { status: 404 });
  // A cover already within the requested box is served as stored (never enlarged, never re-encoded).
  const resized = width !== null && Math.max(asset.width, asset.height) > width;
  const bytes = resized ? await coverVariant(asset, width) : new Uint8Array(asset.bytes);
  return new Response(bytes, { headers: { "Content-Type": resized ? "image/webp" : asset.content_type,
    "Content-Length": String(bytes.byteLength), "X-Content-Type-Options": "nosniff", ETag: resized ? `"${asset.sha256}-w${width}"` : `"${asset.sha256}"`,
    "Cache-Control": publicAsset ? "public, max-age=31536000, immutable" : "private, no-store" } });
}
