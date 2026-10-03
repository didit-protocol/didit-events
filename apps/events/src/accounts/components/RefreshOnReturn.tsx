"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * v5: /me/events stays current without a reload. Coming back to the tab (after cancelling, rejoining or requesting
 * again in another tab or in the join modal) re-renders the server list in place; so does a back/forward cache restore.
 */
export function RefreshOnReturn() {
  const router = useRouter();
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const restored = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", restored);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", restored);
    };
  }, [router]);
  return null;
}
