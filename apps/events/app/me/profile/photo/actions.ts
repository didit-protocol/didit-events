"use server";

import { guestPage } from "../../../../src/auth/access";

import { guardAction, isBodyTooLarge } from "../../../../src/auth/actions";

import { redirect } from "next/navigation";
import type { PhotoState } from "../../../../src/accounts/components/PhotoEditor";
import type { PhotoUploadState } from "../../../../src/accounts/components/PhotoUploader";
import { accountLinks } from "../../../../src/accounts/links";
import { removePhoto, savePhoto } from "./data";
import { IdentityError } from "@didit-events/core/identity";

/** The browser uploads the 512 px crop only; anything else is refused before it is read. */
const MAX_UPLOAD = 300 * 1024;
const JPEG = [0xff, 0xd8, 0xff];

const TOO_LARGE = { error: "Use a 512 by 512 JPEG under 300 KB." };

/** Validates and stores the posted 512 px JPEG (after the caller's guard). Returns a form error or the result. */
async function storePhoto(form: FormData): Promise<{ error: string } | "saved" | "sign_in"> {
  const file = form.get("photo");
  if (!(file instanceof Blob) || file.size === 0) return { error: "Choose a JPG or PNG under 5 MB." };
  if (file.size > MAX_UPLOAD || file.type !== "image/jpeg") return { error: "That photo didn’t upload. Use a JPG or PNG under 5 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!JPEG.every((b, i) => bytes[i] === b)) return { error: "That file is not a JPG or PNG. Use a JPG or PNG under 5 MB." };
  try { return await savePhoto(bytes); }
  catch (error) { if (error instanceof IdentityError && error.status === 400) return TOO_LARGE; throw error; }
}

/** U-35 "Use photo" (the crop page): saves, then shows the profile. */
export async function uploadPhotoAction(_prev: PhotoState, form: FormData): Promise<PhotoState> {
  await guestPage("/me/profile/photo");
  try { await guardAction(form, { maxBytes: 310 * 1024 }); }
  catch (error) { if (isBodyTooLarge(error)) return TOO_LARGE; throw error; }
  const result = await storePhoto(form);
  if (typeof result === "object") return result;
  redirect(result === "sign_in" ? accountLinks.login(accountLinks.photo()) : accountLinks.profile());
}

/** U-34 inline "Upload photo" / "Change" on Edit profile: saves and stays on the page (the client refreshes). */
export async function savePhotoAction(_prev: PhotoUploadState, form: FormData): Promise<PhotoUploadState> {
  await guestPage("/me/profile/photo");
  try { await guardAction(form, { maxBytes: 310 * 1024 }); }
  catch (error) { if (isBodyTooLarge(error)) return TOO_LARGE; throw error; }
  const result = await storePhoto(form);
  if (typeof result === "object") return result;
  if (result === "sign_in") redirect(accountLinks.login(accountLinks.editProfile()));
  return { saved: true };
}

/** U-34 "Remove". */
export async function removePhotoAction(_prev: PhotoUploadState, form: FormData): Promise<PhotoUploadState> {
  await guestPage("/me/profile/photo");
  await guardAction(form);
  if ((await removePhoto()) === "sign_in") redirect(accountLinks.login(accountLinks.editProfile()));
  return { removed: true };
}
