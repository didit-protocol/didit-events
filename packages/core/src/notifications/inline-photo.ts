// Applicant photos in host emails (M-25, M-26). Guest photos are not public, so the email never links one: the stored
// profile photo is shrunk at send time and travels inside the message as an inline attachment the HTML points at
// with `cid:`. Any failure (no photo, unreadable bytes, still too large) leaves the initials avatar.
import sharp from "sharp";
import { log } from "../log.ts";

/** Pixel size of the inline photo (shown at 48 px, 2× for high-density screens). */
export const INLINE_PHOTO_PX = 96;
/** Byte cap per inline photo: a digest carries up to DIGEST_PHOTOS of them. */
export const INLINE_PHOTO_MAX_BYTES = 8 * 1024;
/** The digest embeds at most this many photos; later rows show initials. */
export const DIGEST_PHOTOS = 10;

/** A Resend inline attachment: `content_id` is what `<img src="cid:…">` references. */
export interface InlineImage { filename: string; content: string; content_type: "image/jpeg"; content_id: string }

export const applicantCid = (n: number) => `applicant-${n}`;

/** 96×96 JPEG without metadata, at most 8 KB; null when the bytes cannot be made into one. */
export async function compressPhoto(bytes: Uint8Array | null | undefined): Promise<Buffer | null> {
  if (!bytes?.byteLength) return null;
  try {
    for (const quality of [72, 55, 40]) {
      // sharp drops EXIF/ICC/XMP unless withMetadata() is asked for.
      const out = await sharp(bytes, { limitInputPixels: 2048 * 2048, failOn: "warning" }).rotate().resize(INLINE_PHOTO_PX, INLINE_PHOTO_PX, { fit: "cover" })
        .flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" }).toBuffer();
      if (out.byteLength <= INLINE_PHOTO_MAX_BYTES) return out;
    }
    return null;
  } catch {
    log("email.inline_photo_skipped", { reason: "unreadable" });
    return null;
  }
}

/** The inline attachment for applicant `n`, or null (initials). */
export async function inlinePhoto(bytes: Uint8Array | null | undefined, n: number): Promise<InlineImage | null> {
  const jpeg = await compressPhoto(bytes);
  if (!jpeg) return null;
  const cid = applicantCid(n);
  return { filename: `${cid}.jpg`, content: jpeg.toString("base64"), content_type: "image/jpeg", content_id: cid };
}
