/** Serialized full replacement avoids stale HTTP responses overwriting a newer snapshot. */
export function startLiveSnapshots<T>(options: { fetchSnapshot: () => Promise<T>; replace: (snapshot: T) => void; stream: { addEventListener: (name: string, callback: () => void) => void; close: () => void }; onError?: () => void }) {
 let disposed = false, busy = false, again = false, debounce: ReturnType<typeof setTimeout> | undefined;
 const refresh = async () => {
  if (disposed) return; if (busy) { again = true; return; } busy = true;
  try { const snapshot = await options.fetchSnapshot(); if (!disposed) options.replace(snapshot); } catch { options.onError?.(); }
  finally { busy = false; if (again && !disposed) { again = false; void refresh(); } }
 };
 const signal = () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(() => { void refresh(); }, 250); };
 options.stream.addEventListener("open", () => { void refresh(); });
 options.stream.addEventListener("message", signal);
 const interval = setInterval(() => { void refresh(); }, 15000); void refresh();
 return () => { disposed = true; clearInterval(interval); if (debounce) clearTimeout(debounce); options.stream.close(); };
}
