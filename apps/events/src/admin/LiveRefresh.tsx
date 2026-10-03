"use client";
import { useEffect } from "react";
import { useAdminRouter } from "./useAdminRouter";
import { startLiveSnapshots } from "./live";
export function LiveRefresh({ eventId }: { eventId: string }) {
 const router = useAdminRouter();
 useEffect(() => {
  const controller = new AbortController(), stream = new EventSource("/api/admin/events/" + eventId + "/stream");
  const stop = startLiveSnapshots({ stream, fetchSnapshot: async () => { const response = await fetch("/api/admin/events/" + eventId + "/live", { cache: "no-store", signal: controller.signal }); if (!response.ok) throw new Error("SnapshotUnavailable"); return response.json(); }, replace: () => router.refresh() });
  return () => { stop(); controller.abort(); };
 }, [eventId, router]);
 return null;
}
