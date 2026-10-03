import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NameChangeSheet } from "../../../../src/accounts/components/AccountSheets";
import { EditProfileForm } from "../../../../src/accounts/components/EditProfileForm";
import { accountLinks } from "../../../../src/accounts/links";
import { nameVerified } from "../../../../src/accounts/types";
import { changeNameAction, saveProfileAction } from "./actions";
import { getEditableProfile } from "./data";
import { removePhotoAction, savePhotoAction } from "../photo/actions";

export const metadata: Metadata = { title: "Edit profile · Didit Events", robots: { index: false } };

export default async function EditProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await getEditableProfile();
  if (!account) redirect(accountLinks.login(accountLinks.editProfile()));
  // Only a name an ID document proved is locked behind the sheet; any other name is edited in the form.
  if ((await searchParams).change === "name" && nameVerified(account)) return <NameChangeSheet action={changeNameAction} />;
  return <EditProfileForm account={account} action={saveProfileAction} photo={{ upload: savePhotoAction, remove: removePhotoAction }} />;
}
