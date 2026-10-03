/** The profile-photo file rules, shared by the crop screen, the inline uploader and their tests. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png"];

/** "The file is 14 MB. Use a JPG or PNG under 5 MB." */
export function photoProblem(file: { size: number; type: string }): string | null {
  if (PHOTO_TYPES.includes(file.type) && file.size <= PHOTO_MAX_BYTES) return null;
  const mb = Math.round(file.size / (1024 * 1024));
  return PHOTO_TYPES.includes(file.type) ? `The file is ${mb} MB. Use a JPG or PNG under 5 MB.` : "That file is not a JPG or PNG. Use a JPG or PNG under 5 MB.";
}
