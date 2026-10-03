import { getDb,type Db } from "../db/index.ts";
import { lockForSeatGrant,queryable,withTx } from "../db/tx.ts";
/** Preserves policy/history metadata; the database function is the sole payload rewrite exception. */
export async function retainRequestData(db:Db=getDb()):Promise<number> {
 const q=queryable(db);let purged=0;
 await q.query("delete from registration_drafts where expires_at<=clock_timestamp()");
 for(const event of await q.query<{id:string}>("select id from events where ends_at<clock_timestamp()-interval '90 days' and exists(select 1 from registrations r where r.event_id=events.id and r.application_purged_at is null) order by id")) {
  const accounts=await q.query<{account_id:string}>("select account_id from registrations where event_id=$1 order by account_id",[event.id]);
  purged+=await withTx(async tx=>{if(accounts.length)await lockForSeatGrant(tx,accounts.map(a=>a.account_id),event.id);else await tx.query("select id from events where id=$1 for update",[event.id]);const [result]=await tx.query<{n:number}>("select purge_registration_payloads($1) n",[event.id]);return result?.n??0;},db);
 }
 return purged;
}
