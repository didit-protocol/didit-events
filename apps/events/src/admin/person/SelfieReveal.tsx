"use client";

import { useState } from "react";
import { Button } from "@didit-events/ui";
import s from "./Person.module.css";

/**
 * The selfie Didit approved, staff-only: nothing is requested until "Show selfie" is clicked; the route checks the
 * staff session and answers `private, no-store`, so the image is never cached publicly.
 */
export function SelfieReveal({ src, name }: { src: string; name: string }) {
  const [shown, setShown] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  if (!shown)
    return (
      <div className={s.selfieRow}>
        <Button size="sm" variant="secondary" onClick={() => { setState("loading"); setShown(true); }}>
          Show selfie
        </Button>
        <span className={s.muted}>Loaded from Didit on demand. Staff only.</span>
      </div>
    );
  return (
    <div className={s.selfie}>
      {state === "error" ? (
        <p className={s.muted} role="alert">Couldn’t load the selfie from Didit. Try again later.</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- private, no-store staff route: next/image would cache it
        <img src={src} alt={`Selfie ${name} took for Didit`} referrerPolicy="no-referrer" data-state={state} onLoad={() => setState("ready")} onError={() => setState("error")} />
      )}
      <Button size="sm" variant="ghost" onClick={() => setShown(false)}>
        Hide selfie
      </Button>
    </div>
  );
}
