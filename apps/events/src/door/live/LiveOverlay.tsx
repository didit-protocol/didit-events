"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { VerifiedBadge } from "@didit-events/ui/verified-badge";
import { toDisplay } from "./crop";
import { easeBox, ease, estimateTagSize, placeTag, type Bounds } from "./layout";
import type { LiveStore } from "./store";
import { fitName, initials, type Arrival, type TagView } from "./tags";
import styles from "./live.module.css";

export interface LiveOverlayProps {
  store: LiveStore;
  /** Stage size (design px): the camera layer fills it with object-fit: cover. */
  width: number;
  height: number;
  mirror: boolean;
  /** Small status strip over the live view (offline, scan limit). */
  banner?: string | null;
  arrivals: readonly Arrival[];
  /** Latest live-region sentence. */
  announcement: string;
  timeOf: (at: number) => string;
}

/** Tags stay below the header and above the privacy line. */
const tagBounds = (width: number, height: number): Bounds => ({ left: 32, top: 132, right: width - 32, bottom: height - 110 });

/**
 * The AR layer over the live camera: a soft rounded box on every tracked face, a tag pinned above it (spinner while
 * checking, then name + verified badge + status chip), the Arrivals rail and the idle prompt. Positions are written
 * to the DOM on each animation frame from the store; React renders only when a tag's content changes.
 */
export function LiveOverlay({ store, width, height, mirror, banner, arrivals, announcement, timeOf }: LiveOverlayProps) {
  const content = useSyncExternalStore(store.subscribe, store.content, store.content);
  const nodes = useRef(new Map<number, { box: HTMLDivElement | null; tag: HTMLDivElement | null; shown: { x: number; y: number; w: number; h: number } | null; tagAt: { x: number; y: number } | null }>());
  const geometry = useRef({ width, height, mirror });
  useEffect(() => {
    geometry.current = { width, height, mirror };
  }, [width, height, mirror]);

  useEffect(() => {
    let raf = 0, last = performance.now();
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, t - last);
      last = t;
      const g = geometry.current, cam = store.frame;
      if (!cam) return;
      const bounds = tagBounds(g.width, g.height);
      for (const [id, n] of nodes.current) {
        const box = store.box(id);
        if (!box || !n.box) continue;
        const target = toDisplay(box, cam, { width: g.width, height: g.height }, g.mirror);
        n.shown = easeBox(n.shown, target, dt);
        const s = n.shown;
        n.box.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
        n.box.style.width = `${s.w.toFixed(1)}px`;
        n.box.style.height = `${s.h.toFixed(1)}px`;
        if (!n.tag) continue;
        const place = placeTag(s, { w: n.tag.offsetWidth, h: n.tag.offsetHeight }, bounds);
        n.tagAt = n.tagAt ? { x: ease(n.tagAt.x, place.x, dt), y: ease(n.tagAt.y, place.y, dt) } : { x: place.x, y: place.y };
        n.tag.style.transform = `translate3d(${n.tagAt.x.toFixed(1)}px, ${n.tagAt.y.toFixed(1)}px, 0)`;
        n.tag.dataset.placement = place.placement;
        n.tag.style.visibility = "visible";
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [store]);

  // Element refs only; the eased positions survive re-renders and are dropped with the face.
  const ref = (id: number, part: "box" | "tag") => (el: HTMLDivElement | null) => {
    const n = nodes.current.get(id) ?? { box: null, tag: null, shown: null, tagAt: null };
    n[part] = el;
    nodes.current.set(id, n);
  };
  useEffect(() => {
    const live = new Set(content.faces.map((f) => f.id));
    for (const id of nodes.current.keys()) if (!live.has(id)) nodes.current.delete(id);
  }, [content]);

  // First placement from the store (server render, a new tag); the animation frame loop takes over from there.
  const initial = (id: number, view: TagView) => {
    const box = store.box(id), cam = content.frame;
    if (!box || !cam) return null;
    const shown = toDisplay(box, cam, { width, height }, mirror);
    const place = placeTag(shown, estimateTagSize(view), tagBounds(width, height));
    return { box: { transform: `translate3d(${shown.x.toFixed(1)}px, ${shown.y.toFixed(1)}px, 0)`, width: `${shown.w.toFixed(1)}px`, height: `${shown.h.toFixed(1)}px` },
      tag: { transform: `translate3d(${place.x.toFixed(1)}px, ${place.y.toFixed(1)}px, 0)`, visibility: "visible" as const }, placement: place.placement };
  };

  return (
    <div className={styles.live}>
      <div className={styles.faces} aria-hidden="true">
        {content.faces.map(({ id, view }) => {
          const first = initial(id, view);
          return (
          <div key={id}>
            <div ref={ref(id, "box")} className={styles.box} style={first?.box} data-tone={view.chip?.tone ?? (view.kind === "checking" ? "blue" : undefined)} />
            {view.kind === "none" ? null : (
              <div ref={ref(id, "tag")} className={styles.tag} style={first?.tag} data-placement={first?.placement} data-kind={view.kind}>
                <FaceTag view={view} />
              </div>
            )}
          </div>
          );
        })}
      </div>
      {content.idle ? <p className={styles.idle}>Walk up — we’ll recognise you</p> : null}
      {banner ? <p className={styles.banner} role="status">{banner}</p> : null}
      <ArrivalsRail arrivals={arrivals} timeOf={timeOf} />
      <div className={styles.sr} role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    </div>
  );
}

export function FaceTag({ view }: { view: TagView }) {
  if (view.kind === "checking") {
    return (
      <span className={styles.checking}>
        <span className={styles.spinner} aria-hidden="true" />
        Checking…
      </span>
    );
  }
  if (view.kind === "guidance") return <span className={styles.guidance}>{view.guidance}</span>;
  return (
    <>
      {view.name ? (
        <span className={styles.nameRow}>
          <span className={styles.name}>{fitName(view.name)}</span>
          {view.verified ? <VerifiedBadge label="Verified by Didit" size={28} className={styles.badge} /> : null}
        </span>
      ) : null}
      {view.chip ? <span className={styles.chip} data-tone={view.chip.tone}>{view.chip.text}</span> : null}
    </>
  );
}

export function ArrivalsRail({ arrivals, timeOf }: { arrivals: readonly Arrival[]; timeOf: (at: number) => string }) {
  if (!arrivals.length) return null;
  return (
    <section className={styles.rail} aria-label="Arrivals">
      <h2 className={styles.railTitle}>Arrivals</h2>
      <ol className={styles.railList}>
        {arrivals.map((a) => (
          <li key={a.key} className={styles.arrival} data-tone={a.tone}>
            <span className={styles.avatar} aria-hidden="true">{initials(a.name)}</span>
            <span className={styles.arrivalText}>
              <span className={styles.arrivalName}>
                <span className={styles.arrivalNameText}>{a.name}</span>
                {a.verified ? <VerifiedBadge label="Verified by Didit" size={16} /> : null}
              </span>
              <span className={styles.arrivalMeta}>{a.label} · {timeOf(a.at)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
