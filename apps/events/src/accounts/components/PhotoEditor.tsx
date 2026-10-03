import { PhotoCropper, type PhotoAction, type PhotoState } from "./PhotoCropper";
import { Eyebrow, GuestScreen, type GuestScreenProps } from "./Screen";

export type { PhotoAction, PhotoState };
export { PHOTO_MAX_BYTES, PHOTO_TYPES, photoProblem } from "../photo-file";

/**
 * 05 U-35 (position the photo) and U-36 (upload error). The screen shell is server-rendered; the crop, the file
 * picker and the upload are the client leaf (PhotoCropper.tsx).
 */
export function PhotoEditor({ initials, initialError, previewSrc, action, account }: { initials: string; initialError?: string; previewSrc?: string; action: PhotoAction; account?: GuestScreenProps["account"] }) {
  return (
    <GuestScreen header="account" initials={initials} account={account} labelledBy="photo-title">
      <Eyebrow>PROFILE PHOTO</Eyebrow>
      <PhotoCropper initialError={initialError} previewSrc={previewSrc} action={action} titleId="photo-title" />
    </GuestScreen>
  );
}
