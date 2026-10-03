import { describe, expect, it } from "vitest";
import { advisoryKey, lockForCheckin, lockForDecision, lockForDeletion, lockForSeatGrant, type Tx } from "./tx.ts";

function recorder() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const tx: Tx = { kind: "postgres", async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) { calls.push({ sql, params }); return [{ id: "found" }] as unknown as T[]; } };
  return { tx, calls };
}
describe("C22 explicit lock modes", () => {
  it("check-in locks the owned registration, event and kiosk in order", async () => {
    const { tx, calls } = recorder();
    await lockForCheckin(tx, { accountId: "a", registrationId: "r", eventId: "e", kioskId: "k" });
    expect(calls.map(c => c.sql)).toEqual([
      "select pg_advisory_xact_lock($1::bigint)",
      "select id from registrations where id=$1 and account_id=$2 and event_id=$3 for update",
      "select id from events where id=$1 for share",
      "select id from kiosks where id=$1 and event_id=$2 for share",
    ]);
    expect(calls.map(c => c.params)).toEqual([[advisoryKey("account", "a")], ["r", "a", "e"], ["e"], ["k", "e"]]);
  });
  it("seat grants take unique accounts ascending and event UPDATE directly, with no registration/FK lock first", async () => {
    const { tx, calls } = recorder(); await lockForSeatGrant(tx, ["b", "a", "b"], "event");
    expect(calls.map(c => c.params)).toEqual([[advisoryKey("account", "a")], [advisoryKey("account", "b")], ["event"]]);
    expect(calls.map(c => c.sql)).toEqual(["select pg_advisory_xact_lock($1::bigint)", "select pg_advisory_xact_lock($1::bigint)", "select id from events where id=$1 for update"]);
    await expect(lockForSeatGrant(tx, [], "event")).rejects.toThrow("AccountLockRequired");
  });
  it("decisions take only the account; deletion adds only that account's registrations ascending", async () => {
    const { tx, calls } = recorder(); await lockForDecision(tx, "a");
    expect(calls).toHaveLength(1); expect(calls[0]!.params).toEqual([advisoryKey("account", "a")]);
    calls.length = 0; await lockForDeletion(tx, "a");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ sql: "select id from registrations where account_id=$1 order by id for update", params: ["a"] });
  });
});
