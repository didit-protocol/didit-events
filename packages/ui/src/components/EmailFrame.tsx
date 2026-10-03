"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./EmailPreview.module.css";

export interface EmailFrameProps {
  /** A complete HTML email document. */
  html: string;
  title: string;
  /** Height before the document is measured: the viewport height the preview is laid out for. */
  initialHeight?: number;
}

/** Height reserved before measuring when the caller gives none (the design's 390×844 mobile viewport). */
export const EMAIL_FRAME_VIEWPORT_H = 844;

/**
 * Renders an email document in a sandboxed iframe (no scripts) and sizes it to its content, so the preview shows
 * the whole email at the iframe's width, re-measuring after fonts and images load. Pending work (fonts.ready, the
 * ResizeObserver, image load listeners) is dropped when `html` changes or the frame unmounts.
 */
export function EmailFrame({ html, title, initialHeight = EMAIL_FRAME_VIEWPORT_H }: EmailFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(initialHeight);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let active = true;
    let observer: ResizeObserver | undefined;
    let doc: Document | undefined;
    const measure = () => {
      if (!active) return;
      const body = frame.contentDocument?.body;
      if (body) setHeight(Math.ceil(body.getBoundingClientRect().height));
    };
    const detach = () => {
      observer?.disconnect();
      observer = undefined;
      doc?.removeEventListener("load", measure, true);
      doc = undefined;
    };
    const attach = () => {
      const next = frame.contentDocument;
      const win = frame.contentWindow as (Window & typeof globalThis) | null;
      if (!active || !next?.body || !win) return;
      detach();
      doc = next;
      measure();
      doc.addEventListener("load", measure, true); // images
      void doc.fonts?.ready.then(measure);
      if (typeof win.ResizeObserver === "function") {
        observer = new win.ResizeObserver(measure);
        observer.observe(doc.body);
      }
    };
    // srcdoc may finish loading before hydration: attach now if it has, and on every (re)load.
    if (frame.contentDocument?.readyState === "complete") attach();
    frame.addEventListener("load", attach);
    return () => {
      active = false;
      frame.removeEventListener("load", attach);
      detach();
    };
  }, [html]);

  return <iframe ref={ref} className={styles.frame} title={title} srcDoc={html} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" style={{ height }} />;
}
