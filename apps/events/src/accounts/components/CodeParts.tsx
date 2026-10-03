"use client";

import { useEffect, useState } from "react";
import s from "./Screen.module.css";

/** "0:30" */
export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * "Resend code in 0:30" counting down, then the "Resend code" link (R-04 → R-05). Remount with a new `key` per sent
 * code. `onResend` submits the resend form.
 */
export function ResendTimer({ seconds, prefix = "Resend code in", center, onResend }: { seconds: number; prefix?: string; center?: boolean; onResend: () => void }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setInterval(() => setLeft((l) => (l <= 1 ? 0 : l - 1)), 1000);
    return () => clearInterval(t);
  }, [seconds]);
  if (left > 0)
    return (
      <p className={center ? `${s.resend} ${s.resendCenter}` : s.resend} aria-live="off">
        {`${prefix} ${mmss(left)}`}
      </p>
    );
  return (
    <button type="button" className={s.resendButton} onClick={onResend} style={center ? { alignSelf: "center" } : undefined}>
      Resend code
    </button>
  );
}
