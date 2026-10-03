"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MarkLoader } from "@didit-events/ui";
import type { PublicEvent } from "../../../public/types";
import { clearJoinIntent, markJoinIntent } from "../../join/intent";
import type { JoinInitial } from "../../join/machine";
import type { SignInAction } from "./JoinAuth";
import type { JoinFlowProps } from "./JoinFlow";
import p from "./JoinPlaceholder.module.css";

// The modal (its shell, sign-in, profile, face, request) downloads only when it opens; the event page ships this
// launcher and the placeholder it shows at once.
const loadModal = () => import("./JoinModal");
const JoinModal = lazy(loadModal);

export interface JoinLauncherProps {
  event: PublicEvent;
  /** The page URL has ?join=1 (the server rendered `initial` for it). */
  open: boolean;
  initial: JoinInitial | null;
  signIn: SignInAction;
  /** The visitor is inside an in-app browser (X, LinkedIn, Instagram…): the sign-in step guides them. */
  inApp?: JoinFlowProps["inApp"];
  /** The /me/profile photo actions (the profile step after a request). */
  photo?: JoinFlowProps["photo"];
  /** v5: "Keep my account" (deletion grace period). */
  keepAccount?: JoinFlowProps["keepAccount"];
}

const joinUrl = (slug: string) => `/e/${slug}?join=1`;

/**
 * Opens the join modal over the event page. Links to `/e/<slug>?join=1` (Request to join, Join waitlist) become an
 * in-page navigation that pushes that URL (so Back closes the modal); the server re-renders with the guest's state.
 * Closing (×, Esc) returns to the event URL — Back when the modal was opened here — and focus to the trigger.
 */
export function JoinLauncher({ event, open, initial, signIn, inApp, photo, keepAccount }: JoinLauncherProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [dismissed, setDismissed] = useState<JoinInitial | null>(null);
  /** Opened by a tap here: the placeholder played the entrance, the modal takes its place without a second one. */
  const [tapped, setTapped] = useState(false);
  const openedHere = useRef(false);
  const registered = useRef(false);
  const eventHref = `/e/${event.slug}`;
  const shown = open && initial !== null && initial !== dismissed;

  // The server answered the click: the modal replaces the loading shell.
  if (shown && pending) setPending(false);

  // Prefetch the next step: the modal chunk (and the route) warm up as soon as the pointer or focus reaches a join link.
  useEffect(() => {
    let warmed = false;
    const warm = (e: Event) => {
      if (warmed) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !a.href.includes(joinUrl(event.slug))) return;
      warmed = true;
      void loadModal().catch(() => undefined);
      router.prefetch?.(joinUrl(event.slug));
    };
    document.addEventListener("pointerover", warm, { passive: true });
    document.addEventListener("focusin", warm);
    return () => {
      document.removeEventListener("pointerover", warm);
      document.removeEventListener("focusin", warm);
    };
  }, [event.slug, router]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== eventHref || url.searchParams.get("join") !== "1") return;
      e.preventDefault();
      markJoinIntent(event.slug);
      openedHere.current = true;
      setDismissed(null);
      setTapped(true);
      setPending(true);
      router.push(joinUrl(event.slug), { scroll: false });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [event.slug, eventHref, router]);

  function close() {
    clearJoinIntent(event.slug);
    setDismissed(initial);
    setPending(false);
    setTapped(false);
    // A new registration changes the event page's card: re-render it; otherwise Back keeps history clean.
    if (registered.current) router.replace(eventHref, { scroll: false });
    else if (openedHere.current) router.back();
    else router.replace(eventHref, { scroll: false });
    openedHere.current = false;
    registered.current = false;
    requestAnimationFrame(() => {
      const triggers = Array.from(document.querySelectorAll<HTMLAnchorElement>(`a[href$="${joinUrl(event.slug)}"]`));
      (triggers.find((t) => t.offsetParent !== null) ?? triggers[0])?.focus();
    });
  }

  if (!shown && !pending) return null;
  // While the server answers the tap and the modal's chunk downloads: its frame with the Didit loader (a bottom sheet
  // on phones, like the modal itself).
  const placeholder = (
    <div className={p.scrim}>
      <div role="dialog" aria-modal="true" aria-label="Request to join" aria-busy="true" className={p.dialog}>
        <MarkLoader size={40} />
      </div>
    </div>
  );
  if (!shown || !initial) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <JoinModal flowKey={initial.kind === "signed_in" ? `in:${initial.ctx.onboarding.email.address}` : initial.kind} instant={tapped} event={event} initial={initial} signIn={signIn} inApp={inApp} photo={photo} keepAccount={keepAccount} onClose={close} onRegistered={() => { registered.current = true; }} />
    </Suspense>
  );
}
