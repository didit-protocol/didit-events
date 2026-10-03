import "../../../src/testing/b4";

import { eventService,inviteService } from "@didit-events/core";
import { queryable } from "@didit-events/core/db/tx";
import type * as Shared from "@didit-events/core/admission/shared";
import { beforeEach,expect,it,vi } from "vitest";
import { auth,databaseSuite } from "../../../src/testing/b4";
import { guestFixture,requestFixture } from "../../../../../packages/core/src/testing/model.ts";

// Real queries on the real database; `sql` lists every statement sent through the shared reader.
const sql = vi.hoisted(() => [] as string[]);
vi.mock("@didit-events/core/admission/shared", async original => {
  const actual = await original<typeof Shared>();
  const read: typeof actual.read = db => { const q = actual.read(db); return { query: (text, params) => { sql.push(text); return q.query(text, params); } }; };
  return { ...actual, read };
});
const { acceptInvite, getInvite } = await import("./data");

const state = databaseSuite();
const ACCOUNT = /from accounts where id=/, REDEEMED = /from invite_redemptions/;
const sent = (pattern: RegExp) => sql.filter(text => pattern.test(text)).length;
async function invite(email?: string) {
  const event = (await eventService.get(state.otherId))!;
  return inviteService.create(auth.staff!, { eventId: event.id, email, maxUses: 1, expiresAt: event.startsAt, message: "Please join us" });
}
/** The loader's own statements: the list is cleared right before the call. */
async function load(token: string) { sql.length = 0; return getInvite(token); }
beforeEach(() => { sql.length = 0; });

it("signed out: no account and no redemption is looked up", async () => {
  auth.guest = null;
  const link = await invite("ana@example.test");
  expect(await load(link.token)).toMatchObject({ guest: null, view: { state: "signed_out", email: "ana@example.test", message: "Please join us", event: { slug: "second" } } });
  expect([sent(ACCOUNT), sent(REDEEMED)]).toEqual([0, 0]);
});
it("signed out on a used-up link: expired, still without a lookup", async () => {
  const link = await invite();
  await queryable(state.db).query("update invites set uses=max_uses where id=$1", [link.invite.id]);
  auth.guest = null;
  expect(await load(link.token)).toMatchObject({ guest: null, view: { state: "expired" } });
  expect([sent(ACCOUNT), sent(REDEEMED)]).toEqual([0, 0]);
});
it("signed in: the account and the redemption are each read once", async () => {
  const link = await invite("ana@example.test");
  expect(await load(link.token)).toMatchObject({ guest: { id: state.accountId, email: "ana@example.test", firstName: "Test", lastName: "Guest" }, view: { state: "accepted", message: "Please join us" } });
  expect([sent(ACCOUNT), sent(REDEEMED)]).toEqual([1, 1]);
});
it("signed in as another email than the invite's: wrong account, with the guest resolved", async () => {
  const link = await invite("someone@example.test");
  expect(await load(link.token)).toMatchObject({ guest: { email: "ana@example.test" }, view: { state: "wrong_account", email: "someone@example.test", signedInAs: "ana@example.test" } });
});
it("a used-up link stays open for the guest who redeemed it and is expired for anyone else", async () => {
  const link = await invite();
  expect(await acceptInvite(link.token, await requestFixture(state.db, auth.guest!, state.otherId))).toEqual({ slug: "second" });
  expect(await queryable(state.db).query("select uses,max_uses from invites where id=$1", [link.invite.id])).toEqual([{ uses: 1, max_uses: 1 }]);
  expect(await load(link.token)).toMatchObject({ guest: { id: state.accountId }, view: { state: "accepted" } });
  expect([sent(ACCOUNT), sent(REDEEMED)]).toEqual([1, 1]);
  auth.guest = await guestFixture(state.db, "late@example.test");
  expect(await load(link.token)).toMatchObject({ guest: { id: auth.guest.accountId, email: "late@example.test" }, view: { state: "expired" } });
  expect([sent(ACCOUNT), sent(REDEEMED)]).toEqual([1, 1]);
});
it("a session whose account is being deleted reads as signed out", async () => {
  const link = await invite();
  await queryable(state.db).query("update accounts set deleting_at=clock_timestamp() where id=$1", [state.accountId]);
  expect(await load(link.token)).toMatchObject({ guest: null, view: { state: "signed_out", email: "" } });
});
it("an unknown token reads nothing about the guest", async () => {
  expect(await load("no-such-token")).toEqual({ view: { state: "not_found" }, guest: null });
  expect([sent(ACCOUNT), sent(REDEEMED)]).toEqual([0, 0]);
});
