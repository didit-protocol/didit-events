"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@didit-events/ui";
import { useAdminRouter } from "../useAdminRouter";
import s from "./Sections.module.css";

export interface LeaveGuardProps {
  /** Values differ from the last saved ones. */
  dirty: boolean;
  /** The event is not published yet (a new event, or a saved draft). */
  unpublished: boolean;
  /** Start saving the current values as a draft (the editor's own save); false = it did not start (invalid values). */
  onSaveDraft: () => boolean;
  /** The editor's latest save outcome; a new identity means a save finished. */
  outcome: unknown;
  /** That outcome was a successful save. */
  saved: boolean;
  /** A save is in flight. */
  saving: boolean;
  /** The dialog's save button (default "Save draft"; a published event's settings say "Save changes"). */
  saveLabel?: string;
}

/**
 * The link a click would follow inside this app, or null when the guard must not interfere: modified clicks,
 * new tabs, downloads, other origins, same-page hash links, links that opt out with `data-leave-guard="off"`.
 */
export function guardedHref(e: Pick<MouseEvent, "target" | "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">, here: Location): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const el = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!(el instanceof HTMLAnchorElement)) return null;
  if (el.target && el.target !== "_self") return null;
  if (el.hasAttribute("download") || el.dataset.leaveGuard === "off") return null;
  let url: URL;
  try {
    url = new URL(el.href, here.href);
  } catch {
    return null;
  }
  if (url.origin !== here.origin) return null;
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return url.pathname + url.search + url.hash;
}

/**
 * Leave-page guard of the event editor. In-app links open a dialog (Save draft / Discard / Keep editing) when there
 * are unsaved changes, or (Leave as draft / Keep editing) when a saved event is still unpublished; reloads and
 * closing the tab get the browser's own warning while there are unsaved changes. A failed save keeps the page and
 * its errors: the dialog closes and nothing is lost.
 */
export function LeaveGuard({ dirty, unpublished, onSaveDraft, outcome, saved, saving, saveLabel = "Save draft" }: LeaveGuardProps) {
  const router = useAdminRouter();
  const [target, setTarget] = useState<string | null>(null);
  // Save draft in flight: the outcome it started from; a different outcome means that save finished.
  const [pending, setPending] = useState<{ outcome: unknown } | null>(null);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const leaving = useRef(false);
  const armed = dirty || unpublished;
  const waiting = pending !== null;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      // Older browsers need a returnValue to show the native prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!armed) return;
    const onClick = (e: MouseEvent) => {
      if (leaving.current) return;
      const href = guardedHref(e, window.location);
      if (!href) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(href);
    };
    // Capture on the document: runs before React's root listeners and next/link's client navigation.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [armed]);

  // The save finished: leave on success; on failure stay on the page with its errors.
  if (pending && outcome !== pending.outcome && !saving) {
    setPending(null);
    if (saved && target) setLeaveTo(target);
    setTarget(null);
  }
  useEffect(() => {
    if (!leaveTo) return;
    leaving.current = true;
    router.push(leaveTo);
  }, [leaveTo, router]);

  const go = (href: string) => {
    leaving.current = true;
    setTarget(null);
    router.push(href);
  };

  if (!target) return null;
  const draftOnly = !dirty;
  return (
    <Modal
      open
      role="alertdialog"
      width={420}
      onClose={() => (waiting ? undefined : setTarget(null))}
      title={draftOnly ? "This event isn’t published yet" : "Leave without saving?"}
      description={draftOnly ? "Guests can’t see it until you publish. It stays saved as a draft." : "You have unsaved changes to this event."}
      footer={
        <div className={s.leaveActions}>
          <Button variant="secondary" size="sm" onClick={() => setTarget(null)} disabled={waiting} data-autofocus="">
            Keep editing
          </Button>
          {draftOnly ? (
            <Button size="sm" onClick={() => go(target)}>
              Leave as draft
            </Button>
          ) : (
            <>
              <Button variant="danger-outline" size="sm" onClick={() => go(target)} disabled={waiting}>
                Discard
              </Button>
              <Button
                size="sm"
                loading={waiting}
                onClick={() => {
                  // Invalid values never reach the server: close the dialog so the field errors show.
                  if (onSaveDraft()) setPending({ outcome });
                  else setTarget(null);
                }}
              >
                {saveLabel}
              </Button>
            </>
          )}
        </div>
      }
    />
  );
}
