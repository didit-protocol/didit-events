"use client";

import { Suspense, lazy } from "react";
import { Avatar } from "@didit-events/ui";
import type { AccountMenuProps } from "../../public/components/AccountMenu";

const Menu = lazy(() => import("../../public/components/AccountMenu").then((m) => ({ default: m.AccountMenu })));

/**
 * The public header's account menu for the admin chrome, code-split with React.lazy (the admin routes do not ship
 * the next/dynamic runtime). The server renders the full menu button; until the chunk loads the avatar is shown.
 */
export function AdminAccountMenu(props: AccountMenuProps) {
  return (
    <Suspense fallback={<Avatar name={props.name} email={props.email} src={props.photoUrl} size={32} tone={props.tone ?? "neutral"} />}>
      <Menu {...props} />
    </Suspense>
  );
}
