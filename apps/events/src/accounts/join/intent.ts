/**
 * Join intent (sessionStorage, this tab only): set when the guest taps Request to join. The request is then sent on
 * its own once nothing is left to ask; a shared ?join=1 link without the tap still waits for one tap.
 */

const INTENT_TTL_MS = 30 * 60_000;
const intentKey = (slug: string) => `didit-join:${slug}`;

export function markJoinIntent(slug: string, now = Date.now()) {
  try { sessionStorage.setItem(intentKey(slug), String(now)); } catch { /* storage disabled: one tap instead of auto-submit */ }
}
export function hasJoinIntent(slug: string, now = Date.now()): boolean {
  try {
    const at = Number(sessionStorage.getItem(intentKey(slug)));
    return Number.isFinite(at) && at > 0 && now - at < INTENT_TTL_MS;
  } catch {
    return false;
  }
}
export function clearJoinIntent(slug: string) {
  try { sessionStorage.removeItem(intentKey(slug)); } catch { /* ignore */ }
}

