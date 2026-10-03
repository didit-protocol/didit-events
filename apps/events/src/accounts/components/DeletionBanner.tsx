"use client";

import { useActionState } from "react";
import { usePathname } from "next/navigation";
import { CsrfField } from "../../auth/CsrfField";
import k from "./KeepAccount.module.css";

type KeepState = { error?: string; kept?: boolean };

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Madrid" }).format(new Date(iso));

/**
 * The banner every guest page shows while this browser's account deletion is in its grace period (v5). Deliberately
 * tiny (the root layout ships it to every route): plain form, no UI-kit imports; the action returns to this page.
 */
export function DeletionBanner({ graceUntil, action }: { graceUntil: string; action: (prev: KeepState, form: FormData) => Promise<KeepState> }) {
  const path = usePathname();
  const [state, dispatch, pending] = useActionState(action, {});
  // /me/deleting is the same message as a full screen; the join modal asks in place.
  if (path === "/me/deleting") return null;
  return (
    <div className={k.banner} role="region" aria-label="Account deletion" data-deletion-banner="">
      <p className={k.bannerText}>{state.error ?? `Your account will be deleted on ${day(graceUntil)}.`}</p>
      <form action={dispatch} className={k.inline}>
        <CsrfField />
        <input type="hidden" name="next" value={path && path.startsWith("/") ? path : "/events"} />
        <button type="submit" className={k.bannerButton} disabled={pending} aria-busy={pending || undefined}>
          {pending ? "Keeping…" : "Keep my account"}
        </button>
      </form>
    </div>
  );
}
