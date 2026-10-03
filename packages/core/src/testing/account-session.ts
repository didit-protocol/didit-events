import { queryable } from "../db/tx.ts";
import type { Db } from "../db/index.ts";
import type { createIdentityServices } from "../identity/index.ts";
/** Fixture only: production account emails are created by verified identity flows. */
export async function accountSession(identity: ReturnType<typeof createIdentityServices>, db: Db, email: string) {
  const [account] = await queryable(db).query<{ id: string }>("insert into accounts(email) values($1) on conflict(email) do update set email=excluded.email returning id", [email]);
  return identity.sessions.rotate({ principal: "guest", accountId: account!.id, authMethod: "oidc_google" });
}
