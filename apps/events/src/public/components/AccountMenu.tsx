"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Avatar, cx, type AvatarTone } from "@didit-events/ui";
import { signOutAction } from "../../../app/me/settings/actions";
import { CsrfField } from "../../auth/CsrfField";
import { accountLinks } from "../../accounts/links";
import s from "./AccountMenu.module.css";

export interface AccountMenuItem {
  label: string;
  href: string;
  /** Shown only in the phone header, where the bar itself has no room for it (Explore events). */
  phoneOnly?: boolean;
  /** The page the viewer is on (admin sections). */
  current?: boolean;
  /** Navigate on the client (the admin sections, as in the sidebar) instead of loading a document. */
  client?: boolean;
}

export interface AccountMenuProps {
  staffRole?: "owner" | "admin" | "staff";
  /** Full name; may be empty for a new account (the avatar then uses the email's first letter). */
  name: string;
  email: string;
  photoUrl?: string;
  tone?: AvatarTone;
  /** The links above Sign out. Default: the guest's own pages; the admin passes its sections. */
  items?: readonly AccountMenuItem[];
  /** Sign-out server action. Defaults to the settings page action (CSRF-guarded, revokes the session). */
  signOut?: (form: FormData) => Promise<void>;
  className?: string;
}

/** The header avatar on every page: 32px (--header-avatar) inside the trigger's 44px touch target. */
const AVATAR_SIZE = 32;

const ITEMS: readonly AccountMenuItem[] = [
  { label: "Explore events", href: accountLinks.calendar(), phoneOnly: true },
  { label: "My events", href: accountLinks.myEvents() },
  { label: "Profile", href: accountLinks.editProfile() },
  { label: "Settings", href: accountLinks.settings() },
];
const ADMIN_PANEL: AccountMenuItem = { label: "Admin panel", href: "/admin" };

function SignOutItem({ onKeyDown }: { onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" role="menuitem" tabIndex={-1} className={cx(s.item, s.signOut)} disabled={pending} aria-disabled={pending || undefined} onKeyDown={onKeyDown}>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

/**
 * The header avatar as a menu button (WAI-ARIA menu button pattern): click, Enter, Space or ArrowDown opens it
 * and focuses the first item; ArrowUp/ArrowDown/Home/End move; Escape closes and returns focus to the avatar;
 * Tab or a click outside closes it. On phones the menu also holds the destinations the bar has no room for.
 */
export function AccountMenu({ staffRole, name, email, photoUrl, tone = "neutral", items: custom, signOut = signOutAction, className }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  const menuId = useId();
  const label = name.trim() || email;

  const links = custom ?? (staffRole ? [ADMIN_PANEL, ...ITEMS] : ITEMS);

  // Phone-only items are hidden by CSS on wide headers: the keyboard skips what is not shown.
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []).filter((el) => getComputedStyle(el).display !== "none");
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const list = items();
    (focusOnOpen.current === "last" ? list[list.length - 1] : list[0])?.focus();
    const outside = (e: Event) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) close(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside, { passive: true });
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);

  const openWith = (where: "first" | "last") => {
    focusOnOpen.current = where;
    setOpen(true);
  };

  const onButtonKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openWith("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openWith("last");
    }
  };

  const onItemKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const list = items();
    const at = list.indexOf(e.currentTarget);
    const move = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(list.length - 1);
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={root} className={cx(s.root, className)}>
      <button
        ref={button}
        type="button"
        className={s.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${label}, account menu`}
        onClick={() => (open ? setOpen(false) : openWith("first"))}
        onKeyDown={onButtonKey}
      >
        <Avatar name={name} email={email} src={photoUrl} size={AVATAR_SIZE} tone={tone} />
      </button>
      {open ? (
        <div ref={menu} id={menuId} role="menu" aria-label="Account" className={s.menu}>
          <div className={s.who} role="none">
            <span className={s.whoName}>{name.trim() || "Your account"}</span>
            <span className={s.whoEmail}>{email}</span>
          </div>
          {links.map((item) => {
            const A = item.client ? Link : "a";
            return (
              <A
                key={item.href}
                href={item.href}
                role="menuitem"
                tabIndex={-1}
                aria-current={item.current ? "page" : undefined}
                className={cx(s.item, item.phoneOnly && s.phoneOnly)}
                onKeyDown={onItemKey}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </A>
            );
          })}
          <div role="separator" className={s.sep} />
          <form action={signOut} role="none" className={s.form}>
            <CsrfField />
            <SignOutItem onKeyDown={onItemKey} />
          </form>
        </div>
      ) : null}
    </div>
  );
}
