import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryable } from "../db/tx.ts";
import { splitFullName } from "../domain/profile.ts";
import type { GuestPrincipal } from "../domain/services.ts";
import { testDatabase } from "../testing/database.ts";
import { guestFixture } from "../testing/model.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { createIdentityServices } from "./index.ts";
import { Onboarding } from "./onboarding.ts";

describe.each(["pglite", ...(skipPostgres ? [] : ["postgres"])] as const)("profile name freshness (%s)", driver => {
  let database: Awaited<ReturnType<typeof testDatabase>>, identity: ReturnType<typeof createIdentityServices>, onboarding: Onboarding;
  const q = () => queryable(database.db);
  beforeAll(async () => {
    database = await testDatabase(driver as "pglite" | "postgres");
    identity = createIdentityServices({ db: database.db });
    onboarding = new Onboarding({ db: database.db, launch: async () => ({ state: "not_needed" }) });
  });
  afterAll(async () => { await database?.close(); });

  describe.each(["onboarding", "profile", "accounts"] as const)("%s entry point", entry => {
    async function save(principal: GuestPrincipal, fullName: string) {
      if (entry !== "onboarding") return identity[entry].updateProfile(principal, splitFullName(fullName));
      const account = (await identity.accounts.get(principal.accountId))!;
      return onboarding.saveOnboardingProfile(principal, { expectedProfileVersion: account.profileVersion, fullName });
    }

    it.each(["fullName", "legacy split name"])("compares the effective name against stored %s before writing", async storage => {
      const principal = await guestFixture(database.db);
      if (storage === "legacy split name") await q().query("update accounts set full_name=null where id=$1", [principal.accountId]);
      await q().query("update sessions set authenticated_at=clock_timestamp()-interval '16 minutes' where id=$1", [principal.sessionId]);
      // The caller's still-fresh principal cannot override the persisted session age.
      const before = await identity.accounts.get(principal.accountId);
      for (const name of ["Changed Guest", "Test Changed", ""]) {
        await expect(save(principal, name)).rejects.toMatchObject({ code: "FreshAuthenticationRequired" });
        expect(await identity.accounts.get(principal.accountId)).toEqual(before);
      }
      for (const name of ["Test Guest", "  Test    Guest  "]) {
        await save(principal, name);
        expect(await identity.accounts.get(principal.accountId)).toMatchObject({ fullName: "Test Guest", firstName: "Test", lastName: "Guest" });
      }
      await expect(save(principal, "test Guest")).rejects.toMatchObject({ code: "FreshAuthenticationRequired" });
      await q().query("update sessions set authenticated_at=clock_timestamp() where id=$1", [principal.sessionId]);
      await save(principal, "  Changed    Name  ");
      expect(await identity.accounts.get(principal.accountId)).toMatchObject({ fullName: "Changed Name", firstName: "Changed", lastName: "Name" });
    });
  });

  it("allows non-name onboarding patches on a stale session", async () => {
    const principal = await guestFixture(database.db);
    await q().query("update sessions set authenticated_at=clock_timestamp()-interval '16 minutes' where id=$1", [principal.sessionId]);
    const account = (await identity.accounts.get(principal.accountId))!;
    await onboarding.saveOnboardingProfile(principal, { expectedProfileVersion: account.profileVersion, headline: "Updated role" });
    expect(await identity.accounts.get(principal.accountId)).toMatchObject({ fullName: "Test Guest", headline: "Updated role" });
  });
});
