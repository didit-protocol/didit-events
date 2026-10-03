import sharp from "sharp";
import { lockAccount,queryable,withTx } from "../db/tx.ts";
import { log } from "../log.ts";
import { validatePhoto } from "./accounts.ts";
import type { IdentityContext } from "./shared.ts";

/** Same body cap as a photo upload. */
export const PICTURE_MAX_BYTES = 310 * 1024;
/** Google serves profile pictures from these hosts; Didit may hand back its own copy. Nothing else is fetched. */
const PICTURE_HOST = /^(?:[a-z0-9-]+\.)*(?:googleusercontent\.com|ggpht\.com|didit\.me)$/;

/** The URL to download, or null when it is not an https URL on an allowed host. Google URLs are asked for 512 px. */
export function pictureSource(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !PICTURE_HOST.test(url.hostname)) return null;
  if (/googleusercontent\.com$|ggpht\.com$/.test(url.hostname)) url.pathname = url.pathname.replace(/=s\d+(-c)?$/, "=s512-c");
  return url.href;
}

async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length") ?? 0) > max) throw new Error("too_large");
  if (!response.body) throw new Error("empty");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new Error("too_large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}

/** A downloaded picture as the stored profile photo: one still image, center-cropped to the upload's 512×512 JPEG. */
export async function photoFromPicture(bytes: Uint8Array): Promise<Uint8Array> {
  const image = sharp(bytes, { limitInputPixels: 2048 * 2048, animated: true, failOn: "warning" }), meta = await image.metadata();
  if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height) throw new Error("format");
  const photo = new Uint8Array(await image.rotate().resize(512, 512, { fit: "cover" }).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer());
  validatePhoto(photo);
  return photo;
}

/**
 * Imports the Google profile picture as the account's photo when it has none. Best effort: any failure leaves the
 * account without a photo (the person can upload one). Never overwrites a photo, even one saved meanwhile.
 */
export async function importProfilePicture(ctx: IdentityContext, accountId: string, picture: string | undefined): Promise<boolean> {
  const source = picture ? pictureSource(picture) : null;
  if (!source) return false;
  try {
    const [row] = await queryable(ctx.db()).query<{ has_photo: boolean }>("select photo is not null as has_photo from accounts where id=$1", [accountId]);
    if (!row || row.has_photo) return false;
    const response = await ctx.fetch()(source, { redirect: "error", cache: "no-store", headers: { accept: "image/*" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const photo = await photoFromPicture(await readCapped(response, PICTURE_MAX_BYTES));
    return await withTx(async tx => {
      await lockAccount(tx, accountId);
      const updated = await tx.query("update accounts set photo=$2,photo_url='/api/me/photo',profile_version=profile_version+1,updated_at=clock_timestamp() where id=$1 and photo is null and deleting_at is null and deleted_at is null returning id", [accountId, photo]);
      return updated.length > 0;
    }, ctx.db());
  } catch (error) {
    log("auth.google_picture_skipped", { reason: error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "invalid" });
    return false;
  }
}
