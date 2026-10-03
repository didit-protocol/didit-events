"use client";

import { useEffect } from "react";
import { closeLogin } from "../../src/accounts/login-close";

/** Esc closes /login like its ×. */
export function LoginEscape({ next }: { next: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      e.preventDefault();
      closeLogin(next);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next]);
  return null;
}
