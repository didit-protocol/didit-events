"use client";

import dynamic from "next/dynamic";
import type { AccountMenuProps } from "./AccountMenu";

/**
 * The header account menu, code-split: every public page renders the header, so the menu (and the sign-out server
 * action runtime) loads as its own chunk after first paint instead of counting toward each route's first-load JS.
 * The server still renders the full menu button, so the avatar shows immediately.
 */
export const AccountMenu = dynamic<AccountMenuProps>(() => import("./AccountMenu").then((m) => m.AccountMenu));
