import { isSessionExpired } from "../system/session";

/** What one approve call can answer (the `decideAction` result, loosely typed so tests can stub it). */
export type ApproveOneResult = { ok: true; done: string[]; failed: string[] } | { error: string; message?: string; approved?: number; capacity?: number };

/** What the server says when staff (not owner/admin) try to approve over capacity. */
export const FORBIDDEN_MESSAGE = "Only owners and admins can approve over capacity.";

export interface BulkApproveResult {
  /** Ids the server approved, in order. */
  approved: string[];
  /** Ids the server refused (AP-09: stay selected, drawn failed). */
  failed: string[];
  /** The id the run stopped on (capacity, over-capacity refused, or expired session), if it stopped. */
  stoppedAt?: string;
  reason?: "capacity" | "forbidden" | "expired";
  /** The server's message for a `forbidden` stop. */
  message?: string;
  /** Ids never approved because the run stopped: `stoppedAt` and everything after it. */
  remaining: string[];
  /** The stored numbers the capacity stop answered with (for AP-06). */
  capacity?: { approved: number; capacity: number };
}

/**
 * AP-08: one request per applicant, so the progress, the count and the failures are real. Stops at the first
 * capacity answer, over-capacity refusal (`forbidden`) or expired session; nothing after it is sent.
 */
export async function runBulkApprove(ids: readonly string[], approveOne: (id: string) => Promise<ApproveOneResult>, onStep?: (done: number, total: number, id: string) => void): Promise<BulkApproveResult> {
  const approved: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    onStep?.(i + 1, ids.length, id);
    const result = await approveOne(id);
    if (isSessionExpired(result)) return { approved, failed, stoppedAt: id, reason: "expired", remaining: ids.slice(i) };
    if ("error" in result) {
      if (result.error === "capacity" && typeof result.capacity === "number") return { approved, failed, stoppedAt: id, reason: "capacity", remaining: ids.slice(i), capacity: { approved: result.approved ?? 0, capacity: result.capacity } };
      if (result.error === "forbidden") return { approved, failed, stoppedAt: id, reason: "forbidden", message: result.message ?? FORBIDDEN_MESSAGE, remaining: ids.slice(i) };
      failed.push(id);
      continue;
    }
    if (result.done.includes(id)) approved.push(id);
    else failed.push(id);
  }
  return { approved, failed, remaining: [] };
}
