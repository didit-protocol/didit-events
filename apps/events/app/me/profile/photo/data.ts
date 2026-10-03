import { getDb } from "@didit-events/core/db";
import { queryable } from "@didit-events/core/db/tx";
import { guestPage } from "../../../../src/auth/access";
import { currentGuest } from "../../../../src/accounts/session";
import { identity } from "../../../../src/auth/runtime";
export const getPhotoOwner = () => currentGuest("/me/profile/photo");
/** Stored in Postgres: `accounts.photo` (bytea, the 512 px JPEG) + `photo_url` = /api/me/photo, served by that route. */
export async function savePhoto(jpeg: Uint8Array): Promise<"saved" | "sign_in"> { await identity.profile.savePhoto(await guestPage("/me/profile/photo"), jpeg); return "saved"; }
/** "Remove": clears the stored bytes and the URL; the avatar falls back to the initial. */
export async function removePhoto(): Promise<"removed" | "sign_in"> {
  const principal = await guestPage("/me/profile/photo");
  const rows = await queryable(getDb()).query("update accounts set photo=null,photo_url=null,updated_at=clock_timestamp() where id=$1 and deleting_at is null and deleted_at is null returning id", [principal.accountId]);
  return rows.length ? "removed" : "sign_in";
}
