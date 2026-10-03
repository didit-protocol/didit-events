import { consume } from "../counters.ts";
import { lockForDecision,queryable,withTx } from "../db/tx.ts";
import type { DiditClient } from "../didit/client.ts";
import { withJobLock } from "../jobs.ts";
import { ModelVerification } from "./model-verification.ts";
import { adoptSessionInTx,legacyOperationForHint,resolveVerificationAccount } from "./session-binding.ts";
import { accountFromVendor,liveAccount,uuidPattern,VerificationIgnored } from "./shared.ts";
import type { VerificationLifecycle } from "./verification-service.ts";

export async function reconcile(service: VerificationLifecycle) {
  const { db, workflows, log } = service.options, q = queryable(db);
  const result = await withJobLock("b1.reconcile.sweep", async () => {
    let discovered = 0, fetched = 0;
    const model=new ModelVerification({...service.options,client:service.options.client as DiditClient});
    for(const op of await q.query<{id:string}>("select id from verification_ops where purpose<>'legacy' and state='creating' and expires_at>clock_timestamp() order by created_at limit 10")) {
      try{await model.launch(op.id);}catch{log?.("verification.creation_retry",{});}
    }
    const registry = await q.query<{workflow_id:string}>("select workflow_id from didit_workflows where state='ready'");
    const workflowIds = [...new Set([...Object.keys(workflows),...registry.map(w=>w.workflow_id)])];
    for (const workflowId of workflowIds.sort()) {
      const [recent] = await q.query("select workflow_id from verification_discovery where workflow_id=$1 and completed_at>clock_timestamp()-interval '1 hour'", [workflowId]);
      if (recent) continue;
      for (const remote of await service.listAll({ workflow_id: workflowId })) {
        const mapped = await resolveVerificationAccount(q,remote.session_id);
        if (mapped) { await q.query("update verifications set next_fetch_at=clock_timestamp() where didit_session_id=$1 and reconcile_state='ready' and provider_status is distinct from $2",[remote.session_id,remote.status]); continue; }
        if (!accountFromVendor(remote.vendor_data)) {
          const intents=await q.query("select id from verification_ops where vendor_data=$1 and workflow_id=$2 and purpose<>'legacy' and didit_session_id is null",[remote.vendor_data,workflowId]);
          if(!intents.length)continue;
          if (!(await consume("b1:reconcile:decisions", 30, 60, db)).allowed) break;
          const decision = await service.options.client.getDecision(remote.session_id);
          const opId = decision.metadata?.events_op_id;
          if (typeof opId === "string" && uuidPattern.test(opId) && await withTx(tx=>adoptSessionInTx(tx,opId,decision,service.options.client),db)) discovered++;
          continue;
        }
        const accountId = accountFromVendor(remote.vendor_data);
        if (!accountId || !uuidPattern.test(remote.session_id) || (remote.workflow_id && remote.workflow_id !== workflowId) || !Number.isFinite(Date.parse(remote.created_at))) continue;
        try {
          discovered += await withTx(async tx => {
            await lockForDecision(tx, accountId);
            await liveAccount(tx, accountId, remote.session_id);
            const op = await legacyOperationForHint(tx, remote.session_id, remote.vendor_data, workflowId);
            if (!op || Date.parse(remote.created_at) < op.createdAt.getTime() - 300_000 || Date.parse(remote.created_at) > op.expiresAt.getTime()) return 0;
            const inserted = await tx.query(`insert into verifications(account_id,didit_session_id,workflow_id,vendor_data,created_at,next_fetch_at)
              values($1,$2,$3,$4,$5,clock_timestamp()) on conflict(didit_session_id) do nothing returning id`,
            [accountId, remote.session_id, workflowId, remote.vendor_data, new Date(remote.created_at)]);
            if(inserted[0])await tx.query("update verification_ops set verification_id=$2,didit_session_id=$3 where id=$1",[op.id,inserted[0].id,remote.session_id]);
            if (!inserted.length) await tx.query(`update verifications set next_fetch_at=clock_timestamp() where didit_session_id=$1
              and account_id=$2 and workflow_id=$3 and reconcile_state='ready' and provider_status is distinct from $4`, [remote.session_id, accountId, workflowId, remote.status]);
            return inserted.length;
          }, db);
        } catch (error) { if (!(error instanceof VerificationIgnored)) throw error; }
      }
      await q.query("insert into verification_discovery(workflow_id,completed_at) values($1,clock_timestamp()) on conflict(workflow_id) do update set completed_at=excluded.completed_at", [workflowId]);
    }
    // Derive deadlines from facts, so legacy rows and approvals older than 30 days remain covered.
    const dueSql = `select v.id,v.account_id,v.didit_session_id,v.fetched_at::text as fetched_at,
      case when v.reconcile_state='retry' then v.next_fetch_at else least(
      coalesce(v.next_fetch_at,'infinity'::timestamptz),
      case when v.fetched_at is null then v.created_at
        when v.provider_status is null or v.provider_status not in ('Approved','Declined','Expired','Kyc Expired','Abandoned')
          then v.fetched_at + case when v.created_at>clock_timestamp()-interval '1 hour' then interval '5 minutes' else interval '1 hour' end
        else 'infinity'::timestamptz end,
      case when exists(select 1 from evidence e where e.verification_id=v.id and e.invalidated_at is null)
        then coalesce(v.fetched_at,v.created_at)+interval '24 hours' else 'infinity'::timestamptz end) end as due_at
      from verifications v where v.reconcile_state<>'ignored' and v.workflow_id=any($1::uuid[])`;
    const due = await q.query<{ id: string; account_id: string; didit_session_id: string; fetched_at: string | null; due_at: Date }>(`select * from (${dueSql}) due where due_at<=clock_timestamp() order by due_at,id limit 30`, [workflowIds]);
    for (const row of due) {
      try { await liveAccount(q, row.account_id, row.didit_session_id); }
      catch (error) {
        if (!(error instanceof VerificationIgnored)) throw error;
        await withTx(async tx => {
          await lockForDecision(tx, row.account_id);
          await tx.query("update verifications set reconcile_state='ignored',next_fetch_at=null,last_error='tombstoned' where id=$1", [row.id]);
        }, db);
        continue;
      }
      if (!(await consume("b1:reconcile:decisions", 30, 60, db)).allowed) break;
      fetched += await withTx(async tx => {
        await lockForDecision(tx, row.account_id);
        // A webhook may have refreshed this row since the sweep selected it.
        const [current] = await tx.query("select id from verifications where id=$1 and fetched_at is not distinct from $2::timestamptz and reconcile_state<>'ignored'", [row.id, row.fetched_at]);
        if (!current) return 0;
        await tx.query("savepoint apply_decision");
        try {
          await service.evidence.applyDecision(tx, row.account_id, row.didit_session_id);
          await tx.query("release savepoint apply_decision");
          return 1;
        } catch (error) {
          // Roll back partial evidence, retaining the account lock while scheduling retry.
          await tx.query("rollback to savepoint apply_decision");
          if (error instanceof VerificationIgnored) {
            await tx.query("update verifications set reconcile_state='ignored',next_fetch_at=null,last_error='verification_ignored' where id=$1", [row.id]);
          } else {
            await tx.query(`update verifications set reconcile_state='retry',fetch_attempts=fetch_attempts+1,last_error='decision_apply_failed',
              next_fetch_at=clock_timestamp()+least(power(2,least(fetch_attempts+1,9)),360)*interval '1 minute' where id=$1`, [row.id]);
            log?.("verification.reconcile_failed", {});
          }
          await tx.query("release savepoint apply_decision");
          return 0;
        }
      }, db);
    }
    const [backlog] = await q.query<{ seconds: number | string }>(`select greatest(0,coalesce(extract(epoch from clock_timestamp()-min(due_at)),0)) as seconds from (${dueSql}) due where due_at<=clock_timestamp()`, [workflowIds]);
    const backlogSeconds = Math.floor(Number(backlog?.seconds ?? 0));
    if (backlogSeconds > 3600) log?.("verification.reconcile_backlog", { backlogSeconds });
    return { fetched, discovered, backlogSeconds };
  }, db);
  return result.acquired ? result.value : { fetched: 0, discovered: 0, backlogSeconds: 0 };
}

export async function retainVerificationData(service: VerificationLifecycle): Promise<void> {
  const db = service.options.db, q = queryable(db);
  // Keep replay keys. Reconciliation replaces signals that exceed the raw-body retention deadline.
  const expired = await q.query(`update inbox set raw=null,headers=null,
    error=case when processed_at is null then 'retention_expired' else error end,
    processed_at=coalesce(processed_at,clock_timestamp())
    where verified_at<clock_timestamp()-interval '14 days' and raw is not null returning error`);
  const abandoned = expired.filter(row => row.error === "retention_expired").length;
  if (abandoned) service.options.log?.("verification.inbox_retention_expired", { count: abandoned });
  const accounts = await q.query<{ id: string }>("select id from accounts order by id");
  for (const account of accounts) await withTx(async tx => {
    await lockForDecision(tx, account.id);
    await tx.query("update accounts set profile_links_legacy=null where id=$1 and (profile_links_legacy->>'expiresAt')::timestamptz<=clock_timestamp()",[account.id]);
    await tx.query("update verification_ops set state='expired' where account_id=$1 and state in ('creating','active') and expires_at<=clock_timestamp()", [account.id]);
    // Preserve face ancestors needed by live proofs and exact evidence used by historical attendance.
    await tx.query(`with recursive retained as (
      select distinct face.verification_id,face.continuity_of from evidence face where face.account_id=$1 and face.kind='face'
        and (exists(select 1 from evidence e where e.verification_id=face.verification_id and e.valid_until>clock_timestamp())
          or exists(select 1 from checkins c where c.face_evidence_id=face.id)
          or exists(select 1 from evidence bound where bound.subject_face_id=face.id)
          or exists(select 1 from verification_ops op where op.subject_face_id=face.id))
      union
      select e.verification_id,e.continuity_of from evidence e join retained r on e.verification_id=r.continuity_of where e.account_id=$1 and e.kind='face'
    ) delete from evidence e where e.account_id=$1 and e.valid_until<=clock_timestamp()
      and not exists(select 1 from checkins c where c.face_evidence_id=e.id)
      and not exists(select 1 from evidence bound where bound.subject_face_id=e.id)
      and not exists(select 1 from verification_ops op where op.subject_face_id=e.id)
      and not (e.kind='face' and exists(select 1 from retained r where r.verification_id=e.verification_id))`, [account.id]);
    await tx.query(`update verifications v set next_fetch_at=null where v.account_id=$1 and v.policy_state is null
      and v.provider_status in ('Approved','Declined','Expired','Kyc Expired','Abandoned')
      and not exists(select 1 from evidence e where e.verification_id=v.id and e.invalidated_at is null)`, [account.id]);
    await tx.query(`update verifications v set decision=null,hosted_url=null where v.account_id=$1 and (v.decision is not null or v.hosted_url is not null)
      and coalesce(v.evidence_expires_at,(select max(e.valid_until) from evidence e where e.verification_id=v.id),v.decided_at,v.created_at)<=clock_timestamp()-interval '30 days'`, [account.id]);
  }, db);
}
