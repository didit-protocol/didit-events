"use client";

import { useEffect, useRef, useState } from "react";
import { ClientButtonLink, Icon, toast } from "@didit-events/ui";
import { can } from "@didit-events/core/access/capabilities";
import { adminLinks } from "../links";
import { LifecycleControls } from "../settings/LifecycleControls";
import type { EventHeaderInfo } from "../types";
import s from "./EventHeader.module.css";

const lifecycle = { draft: "draft", open: "published", live: "live", ended: "ended", cancelled: "cancelled" } as const;

/**
 * Header actions on every event tab (top right): the public link as two icon buttons (open ↗, copy), the Door,
 * and the lifecycle button (Publish while draft, Cancel once published), each only for roles that hold it.
 * On phones the row is the Door (and Publish) plus one "More" button: the link actions and Cancel event, last and
 * red, open in a small panel under it. Same DOM on every width: EventHeader.module.css switches the layout.
 */
export function EventHeaderActions({ event }: { event: EventHeaderInfo }) {
  const role = event.role ?? "staff";
  const lifecycleAllowed = event.status === "draft" ? can(role, "event.publish") : can(role, "event.danger");
  const url = event.publicUrl ?? `https://${event.requestLink}`;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ message: "Event link copied" });
    } catch {
      toast({ message: "Couldn’t copy. The link is " + event.requestLink, tone: "danger" });
    }
  };
  // The phone panel closes on Escape and on a press outside it (its own controls stay mounted: CSS hides them).
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const outside = (e: PointerEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [more]);
  const controls = lifecycleAllowed ? <LifecycleControls eventId={event.id} status={lifecycle[event.status]} editVersion={event.editVersion} /> : null;
  const draft = event.status === "draft";
  return (
    <div className={s.actions}>
      {/* A cancelled event has no door. */}
      {can(role, "door.operate") && event.status !== "cancelled" ? (
        <ClientButtonLink variant="secondary" className={s.door} href={adminLinks.tab(event.id, "door")}>
          Open door
        </ClientButtonLink>
      ) : null}
      {/* Publish is the draft's primary action: it stays in the row on every width. */}
      {controls && draft ? <div className={s.life}>{controls}</div> : null}
      <div className={s.more} ref={moreRef}>
        <button type="button" className={`${s.iconBtn} ${s.moreBtn}`} aria-label="More actions" aria-expanded={more} onClick={() => setMore((o) => !o)}>
          <span aria-hidden="true">⋯</span>
        </button>
        <div className={s.morePanel} data-open={more ? "" : undefined}>
          <a className={s.iconBtn} href={url} target="_blank" rel="noopener noreferrer" aria-label="Open the event page in a new tab" title="Open event page" onClick={() => setMore(false)}>
            <Icon name="external" size={16} />
            <span className={s.moreLabel} aria-hidden="true">Open event page</span>
          </a>
          <button type="button" className={s.iconBtn} onClick={() => { void copy(); setMore(false); }} aria-label={copied ? "Event link copied" : "Copy the event link"} title={copied ? "Copied" : "Copy event link"}>
            <Icon name={copied ? "check" : "copy"} size={16} />
            <span className={s.moreLabel} aria-hidden="true">Copy event link</span>
          </button>
          {controls && !draft ? <div className={s.life}>{controls}</div> : null}
        </div>
      </div>
    </div>
  );
}
