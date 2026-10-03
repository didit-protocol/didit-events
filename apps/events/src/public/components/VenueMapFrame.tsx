"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The Google Maps embed, mounted only where its box is displayed. The event page renders a desktop and a phone layout
 * and CSS shows one of them: a server-rendered iframe would be in the document twice. An element inside a
 * `display: none` layout never intersects, so the hidden layout stays a plain placeholder; the visible one mounts its
 * embed a screen before it scrolls into view (what `loading="lazy"` did). Without JavaScript the <noscript> embed loads.
 */
export function VenueMapFrame({ src, title, className, sentinelClassName }: { src: string; title: string; className?: string; sentinelClassName?: string }) {
  const sentinel = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setNear(true);
        io.disconnect();
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  if (near) return <iframe className={className} title={title} src={src} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />;
  return (
    <>
      <span ref={sentinel} className={sentinelClassName} aria-hidden="true" data-venue-map-pending="" />
      <noscript>
        <iframe className={className} title={title} src={src} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
      </noscript>
    </>
  );
}
