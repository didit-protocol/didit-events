import type { ReactNode } from "react";
import Link from "next/link";
import { cx } from "../cx";
import { HEADER_LOGO_HEIGHT, Logo } from "../Logo";
import { Avatar } from "./Display";
import { Icon, type IconName } from "./Icon";
import styles from "./AdminSidebar.module.css";

export type AdminSection = "events" | "team" | "calendar" | "people";

const NAV: Array<{ key: AdminSection; label: string; icon: IconName; href: string }> = [
  { key: "events", label: "Events", icon: "events", href: "/admin" },
  { key: "team", label: "Team", icon: "team", href: "/admin/team" },
  { key: "calendar", label: "Calendar", icon: "calendar", href: "/admin/calendar" },
  { key: "people", label: "People", icon: "user", href: "/admin/people" },
];
/** People (every account) is owner-only, so it shows only when the app lists it in `sections`. */
const DEFAULT_SECTIONS: readonly AdminSection[] = ["events", "team", "calendar"];

export interface AdminSidebarProps {
  active: AdminSection;
  user: { name: string; email: string; initials?: string; photoUrl?: string };
  /** Override nav hrefs (defaults: /admin, /admin/team, /admin/calendar). */
  hrefs?: Partial<Record<AdminSection, string>>;
  /** Sections to show (default Events, Team, Calendar). Event team members only see Events; owners add People. */
  sections?: readonly AdminSection[];
  /** Sign-out control; defaults to a POST form to `signOutAction`. */
  signOut?: ReactNode;
  /**
   * The whole account block (avatar, name, menu). The app passes the same avatar menu as the public header; when
   * absent the sidebar shows the avatar, name and a Sign out button.
   */
  account?: ReactNode;
  signOutAction?: string | ((form: FormData) => void | Promise<void>);
  signOutFields?: ReactNode;
  homeHref?: string;
  className?: string;
}

/**
 * The 232px admin sidebar: Didit + EVENTS chip, Events / Team / Calendar (/ People), user and sign out. The sections
 * are client navigation (next/link); sign out stays a form post, it changes cookies.
 */
export function AdminSidebar({ active, user, hrefs, sections, signOut, account, signOutAction = "/api/auth/logout", signOutFields, homeHref = "/admin", className }: AdminSidebarProps) {
  return (
    <aside className={cx(styles.sidebar, className)}>
      <div className={styles.brand}>
        <Link href={homeHref} aria-label="Didit Events home">
          <Logo variant="color" height={HEADER_LOGO_HEIGHT} alt="Didit" />
        </Link>
        <span className={styles.chip}>Events</span>
      </div>
      <nav aria-label="Admin">
        <ul className={styles.nav}>
          <li><Link href="/events" className={styles.item}>View site</Link></li>
          {NAV.filter((n) => (sections ?? DEFAULT_SECTIONS).includes(n.key)).map((n) => (
            <li key={n.key}>
              <Link href={hrefs?.[n.key] ?? n.href} className={styles.item} aria-current={n.key === active ? "page" : undefined}>
                <Icon name={n.icon} size={18} />
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {account ? (
        <div className={styles.user}>{account}</div>
      ) : (
        <div className={styles.user}>
          <Avatar name={user.name} email={user.email} initials={user.initials} src={user.photoUrl} tone="brand" size={32} />
          <div className={styles.who}>
            <span className={styles.name}>{user.name}</span>
            <span className={styles.email}>{user.email}</span>
          </div>
          {signOut ?? (
            <form action={signOutAction} method={typeof signOutAction === "string" ? "post" : undefined}>
              {signOutFields}
              <button type="submit" className={styles.signOut}>
                Sign out
              </button>
            </form>
          )}
        </div>
      )}
    </aside>
  );
}
