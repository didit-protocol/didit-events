import { accountLinks } from "../../accounts/links";
import { AdminAccountMenu } from "./AdminAccountMenu";
import type { StaffUser } from "../types";
import s from "./AdminShell.module.css";

/** The sidebar already lists the admin sections, so its menu holds the staff member's own pages. */
const OWN_PAGES = [
  { label: "My events", href: accountLinks.myEvents() },
  { label: "Profile", href: accountLinks.editProfile() },
  { label: "Settings", href: accountLinks.settings() },
];

/**
 * The sidebar's account block: the site header's avatar (one letter, or the profile photo) and its menu (My events,
 * Profile, Settings, Sign out) with the name and email beside it. The menu opens upwards. On phones the sidebar is
 * replaced by the site header, whose avatar menu lists the admin sections (AdminShell).
 */
export function SidebarAccount({ user }: { user: StaffUser }) {
  return (
    <div className={s.account}>
      <AdminAccountMenu name={user.name} email={user.email} photoUrl={user.photoUrl} items={OWN_PAGES} className={s.accountUp} />
      <span className={s.accountWho}>
        <span className={s.accountName}>{user.name.trim() || "Your account"}</span>
        <span className={s.accountEmail}>{user.email}</span>
      </span>
    </div>
  );
}
