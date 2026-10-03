import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PhotoEditor } from "../../../../src/accounts/components/PhotoEditor";
import { initialsOf } from "../../../../src/accounts/components/StatusScreen";
import { accountLinks } from "../../../../src/accounts/links";
import { uploadPhotoAction } from "./actions";
import { getPhotoOwner } from "./data";

// Personal, session-bound page: never prerendered.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Profile photo · Didit Events", robots: { index: false } };

export default async function PhotoPage() {
  const account = await getPhotoOwner();
  if (!account) redirect(accountLinks.login(accountLinks.photo()));
  return <PhotoEditor initials={initialsOf(account)} previewSrc={account.photoUrl} action={uploadPhotoAction} account={account} />;
}
