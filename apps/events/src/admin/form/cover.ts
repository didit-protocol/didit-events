import { COVER_MAX_BYTES } from "./validate";

/** Longest side of an uploaded cover after in-browser downscaling (the design asks for 1600×900; 2400 keeps 1.5× room). */
export const COVER_MAX_SIDE = 2400;
const ACCEPTED = ["image/jpeg", "image/png"];

export type PreparedCover = { ok: true; file: File } | { ok: false; error: string };

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Makes a picked image uploadable: a JPG/PNG under the limit passes through; anything larger (a 20 MB camera photo)
 * or any other image type is decoded, downscaled to COVER_MAX_SIDE and re-encoded as JPEG in the browser, so the
 * server action never receives a body above its parser ceiling. Returns a field error when that is not possible.
 */
export async function prepareCover(file: File, encode: (canvas: HTMLCanvasElement) => Promise<Blob | null> = (c) => new Promise((r) => c.toBlob(r, "image/jpeg", 0.85))): Promise<PreparedCover> {
  if (ACCEPTED.includes(file.type) && file.size <= COVER_MAX_BYTES) return { ok: true, file };
  if (!file.type.startsWith("image/")) return { ok: false, error: "Use a JPG or PNG" };
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { return { ok: false, error: "We couldn't read that image. Use a JPG or PNG" }; }
  const scale = Math.min(1, COVER_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await encode(canvas);
  if (!blob || blob.size > COVER_MAX_BYTES) return { ok: false, error: `That image is too large (${mb(file.size)}). Use one under 5 MB` };
  return { ok: true, file: new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) };
}
