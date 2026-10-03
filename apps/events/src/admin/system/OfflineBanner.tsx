"use client";

import { useSyncExternalStore } from "react";
import { Banner } from "@didit-events/ui";
import { SYSTEM_COPY } from "./copy";
import s from "./System.module.css";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** A-13d: shown while the browser is offline. `offline` forces it (frame gallery). */
export function OfflineBanner({ offline }: { offline?: boolean }) {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  return (
    <div aria-live="polite" className={s.live}>
      {offline || !online ? (
        <Banner tone="info" className={`${s.strip} ${s.offline}`}>
          <span className={s.dot} aria-hidden="true" />
          <span>{SYSTEM_COPY.offline}</span>
        </Banner>
      ) : null}
    </div>
  );
}
