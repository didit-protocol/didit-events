import type { ReactNode } from "react";
import { AdminSidebar, type AdminSection } from "@didit-events/ui";
import { can } from "@didit-events/core/access/capabilities";
import type { AccountMenuItem } from "../../public/components/AccountMenu";
import { SiteHeaderBar } from "../../public/components/SiteHeaderBar";
import { adminLinks } from "../links";
import type { StaffUser } from "../types";
import { AdminAccountMenu } from "./AdminAccountMenu";
import { SidebarAccount } from "./SidebarAccount";
import s from "./AdminShell.module.css";

export interface AdminShellProps {
  active: AdminSection;
  user: StaffUser;
  /** Frame gallery only (A-05 390 drew a back link in the old phone bar); the shared header always shows the logo. */
  mobileBack?: { href: string; label: string };
  /** Full-width strip above the page (A-13 offline / Didit API banners). */
  banner?: ReactNode;
  /** Frame gallery: fill the frame box (fixed design height) instead of the viewport. */
  fill?: boolean;
  children: ReactNode;
}

/**
 * The staff admin layout: the 232px sidebar and the page. It is a size container, so the 1024 and 390 layouts
 * follow the box width (the /_frames boxes and the real viewport alike). Below 900px (phones, tablet portrait) the
 * sidebar gives way to the site header (the same bar as the public pages); its avatar menu lists the sections.
 */
/** The sections the viewer may open: members only Events; People only with `people.view` (owners). */
export function adminSections(user: StaffUser): AdminSection[] {
  if (user.member) return ["events"];
  return ["events", "team", "calendar", ...(can(user.role, "people.view") ? (["people"] as const) : [])];
}

const MENU: Array<{ key: AdminSection; label: string; href: string }> = [
  { key: "events", label: "Events", href: adminLinks.home() },
  { key: "people", label: "People", href: adminLinks.people() },
  { key: "team", label: "Team", href: adminLinks.team() },
  { key: "calendar", label: "Calendar", href: adminLinks.calendar() },
];

/** The phone header's avatar menu in the admin: the sections the viewer may open, then View site (Sign out follows). */
export function adminMenuItems(user: StaffUser, active?: AdminSection): AccountMenuItem[] {
  const sections = adminSections(user);
  return [
    ...MENU.filter((m) => sections.includes(m.key)).map((m) => ({ label: m.label, href: m.href, current: m.key === active, client: true })),
    { label: "View site", href: "/events", client: true },
  ];
}

export function AdminShell({ active, user, banner, fill, children }: AdminShellProps) {
  return (
    <div className={s.host} data-fill={fill ? "" : undefined}>
      <div className={s.shell}>
        <AdminSidebar className={s.sidebar} active={active} user={user} sections={adminSections(user)} account={<SidebarAccount user={user} />} />
        <SiteHeaderBar className={s.mobileBar} home={adminLinks.home()} homeLabel="Didit Events admin, all events">
          <AdminAccountMenu name={user.name} email={user.email} photoUrl={user.photoUrl} items={adminMenuItems(user, active)} />
        </SiteHeaderBar>
        <div className={s.main}>
          {banner}
          {children}
        </div>
      </div>
    </div>
  );
}
