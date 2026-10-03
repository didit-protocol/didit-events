import { accountLinks } from "../links";
import { fullName, type GuestAccount } from "../types";
import type { SuggestSocial } from "../social-suggest";
import { EditProfileFields, type EditProfileAction, type EditProfileState } from "./EditProfileFields";
import { PhotoUploader, type PhotoUploadAction } from "./PhotoUploader";
import { Eyebrow, GuestScreen, RowAction, RowGroup, Title } from "./Screen";
import { initialsOf } from "./StatusScreen";
import { displayName } from "../../public/viewer-name";

export type { EditProfileAction, EditProfileState };

/**
 * 05 U-34: photo, name (locked once an ID proved it: changing it goes through U-37), headline, bio, links. The screen
 * shell is server-rendered; the photo uploader and the fields (EditProfileFields.tsx) are the client leaves.
 */
export function EditProfileForm({ account, action, photo, focus, suggestSocial }: { account: GuestAccount; action: EditProfileAction; photo?: { upload: PhotoUploadAction; remove: PhotoUploadAction }; focus?: "bio"; suggestSocial?: SuggestSocial }) {
  return (
    <GuestScreen header="account" initials={initialsOf(account)} accountName={displayName(account)} account={account} labelledBy="edit-title">
      <Eyebrow>EDIT PROFILE</Eyebrow>
      <Title id="edit-title" size={24}>
        Your profile
      </Title>
      {photo ? (
        <PhotoUploader name={fullName(account)} email={account.email} photoUrl={account.photoUrl} upload={photo.upload} remove={photo.remove} />
      ) : (
        <RowGroup title="PHOTO" rows={[{ label: "Profile photo", detail: "JPG or PNG, up to 5 MB. Shown to hosts, not used for check-in.", action: <RowAction href={accountLinks.photo()}>Change</RowAction> }]} />
      )}
      <EditProfileFields account={account} action={action} focus={focus} suggestSocial={suggestSocial} />
    </GuestScreen>
  );
}
