import { randomUUID } from "node:crypto";
import { cp,mkdir,mkdtemp,readFile,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe,expect,it } from "vitest";
import { checksSchema,doorSchema,emailsSchema,formSchema } from "../domain/event-model.ts";
import { testDatabase } from "../testing/database.ts";
import { skipPostgres } from "../testing/postgres.ts";
import { migrate,MIGRATIONS_DIR } from "./migrate.ts";
import { queryable } from "./tx.ts";

describe.each(["pglite", ...(skipPostgres ? [] : ["postgres"])] as const)("0021 populated migration after API tokens (%s)", driver => {
  it("preserves pre-feature state and fails closed on invalid v2 SQL writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "event-model-migration-"));
    await mkdir(join(dir, "meta"));
    const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 20);
    for (const e of journal.entries) await cp(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
    await writeFile(join(dir, "meta/_journal.json"), JSON.stringify(journal));
    const fixture = await testDatabase(driver as "pglite" | "postgres", dir);
    try {
      const q = queryable(fixture.db), account = randomUUID(), unproven = randomUUID(), event = randomUUID(), verification = randomUUID(), face = randomUUID(), session = randomUUID(), op = randomUUID();
      const profile = [{ label: "Website", href: "https://example.com" }];
      await q.query("insert into accounts(id,email,first_name,last_name,headline,company,job_role,bio,profile_links) values($1,'proven@example.test','Alex','Smith','Engineer','Example','','Building things',$2::jsonb)", [account, JSON.stringify(profile)]);
      await q.query("insert into accounts(id,email,profile_links) values($1,'invited@example.test','[{\"label\":\"Bad\",\"href\":\"http://example.test\"}]')", [unproven]);
      await q.query("insert into account_identities(account_id,issuer,subject) values($1,'https://identity.didit.me','verified-oidc')", [account]);
      await q.query("insert into sessions(id,account_id,principal,auth_method,token_hash,csrf_token,expires_at) values($1,$2,'guest','oidc_google','migration-session','migration-csrf',now()+interval '1 year')", [session, account]);
      await q.query("insert into staff(email,role) values('admin@didit.me','admin')");
      await q.query("insert into api_tokens(name,token_hash,staff_email) values('Migration token','fixture-token-hash','admin@didit.me')");
      await q.query("insert into sessions(principal,auth_method,staff_email,token_hash,expires_at) values('staff','email_otp','admin@didit.me','legacy-staff',now()+interval '1 day')");
      await q.query("insert into calendar_profiles(key,name) values('default','Calendar preserved')");
      await q.query(`insert into events(id,slug,name,starts_at,ends_at,capacity,status,venue,address,place_id,lat,lng,maps_url,cover,welcome_options,email_content,max_age)
        values($1,'migration-event','Migration',now()+interval '1 day',now()+interval '2 days',20,'published','HQ','One Street','place-1',41.4,2.1,'https://maps.google.com/?q=HQ','{"theme":"sky","privacy":{"guestList":"names"}}',
        '{"questions":[{"id":"why","label":"Why join?","kind":"long","required":true}],"welcomeEmail":false,"welcome":{"subject":"Welcome","block":"Old block"},"dailyScanBudget":123}',
        '{"arrivalNote":"Saved arrival"}','{"face":86400}')`, [event]);
      await q.query("insert into verifications(id,account_id,didit_session_id,workflow_id,vendor_data,status,provider_status,liveness_at) values($1,$2,$3,$4,$5,'approved','Approved',now()-interval '1 day')", [verification, account, randomUUID(), randomUUID(), `acct_${account}`]);
      await q.query("insert into evidence(id,account_id,verification_id,kind,provider_status,activation,state,established_at,valid_until) values($1,$2,$3,'face','approved','active','active',now()-interval '1 day',now()+interval '179 days')", [face, account, verification]);
      const [v] = await q.query<{ workflow_id: string }>("select workflow_id from verifications where id=$1", [verification]);
      await q.query("insert into verification_ops(id,account_id,workflow_id,kind,state,verification_id,expires_at) values($1,$2,$3,'full','completed',$4,now()+interval '1 day')", [op, account, v!.workflow_id, verification]);
      const registrationIds: string[] = [];
      for (const admission of ["pending", "approved", "waitlisted", "rejected", "cancelled_by_guest", "cancelled_by_host", "revoked"]) {
        const id = randomUUID(), owner = admission === "approved" ? account : randomUUID();
        if (owner !== account) await q.query("insert into accounts(id,email) values($1,$2)", [owner, `${owner}@example.test`]);
        await q.query("insert into registrations(id,event_id,account_id,admission,application) values($1,$2,$3,$4,'{\"why\":\"Meet builders\",\"unknown\":\"Old answer\",\"blocked\":true,\"_internal\":true}')", [id, event, owner, admission]);
        registrationIds.push(id);
      }
      await q.query("insert into checkins(event_id,registration_id,method,face_evidence_id) values($1,$2,'manual',$3)", [event, registrationIds[1], face]);
      const before = await q.query("select id,account_id,verification_id,kind::text,provider_status,activation,established_at,valid_until from evidence");
      await migrate(fixture.db); await migrate(fixture.db);
      expect(await q.query("select id,account_id,verification_id,kind::text,provider_status,activation,established_at,valid_until from evidence")).toEqual(before);
      expect(await q.query("select csrf_token from sessions where id=$1", [session])).toEqual([{ csrf_token: "migration-csrf" }]);
      expect(await q.query("select name from api_tokens")).toEqual([{name:"Migration token"}]);
      expect(await q.query("select name from calendar_profiles")).toEqual([{ name: "Calendar preserved" }]);
      const [saved] = await q.query<{ form: { questions: { id: string }[] }; emails: { templates: Record<string, unknown> }; checks: unknown; door: unknown; cover: unknown; place_id: string }>("select * from events where id=$1", [event]);
      expect(saved).toMatchObject({ place_id: "place-1", cover: { kind: "theme", theme: "sky", privacy:{guestList:"names"} }, door: { kiosk: true, mode: "supervised", match_threshold: 80 }, checks: { version: 1, required: [], max_age: {} } });
      expect(saved!.emails.templates["M-13"]).toEqual({ enabled: false, subject: "Welcome", body_md: "Saved arrival" });
      const registrations = await q.query<{ legacy_imported: boolean; request_receipt: unknown; application_v2: { answers: Record<string, string> }; blocked: boolean }>("select * from registrations order by id");
      expect(registrations).toHaveLength(7);
      for (const r of registrations) {
        expect(r.legacy_imported).toBe(true); expect(r.request_receipt).toBeNull(); expect(r.blocked).toBe(true);
        expect(r.application_v2.answers[saved!.form.questions[0]!.id]).toBe("Meet builders");
      }
      expect((await q.query("select onboarded_at from accounts where id=$1", [account]))[0]!.onboarded_at).toBeInstanceOf(Date);
      expect((await q.query("select email_verified_at,profile_completed_at,onboarded_at,profile_links,profile_links_legacy from accounts where id=$1", [unproven]))[0]).toMatchObject({ email_verified_at: null, profile_completed_at: null, onboarded_at: null, profile_links: [] });
      expect((await q.query("select vendor_data,purpose from verification_ops where id=$1", [op]))[0]).toEqual({ vendor_data: `acct_${account}`, purpose: "legacy" });
      expect(await q.query("select id from outbox")).toHaveLength(0);
      for (const [name, schema, valid] of [["event_checks_v1_ok", checksSchema, saved!.checks], ["event_door_v1_ok", doorSchema, saved!.door], ["event_form_v1_ok", formSchema, saved!.form], ["event_emails_v1_ok", emailsSchema, saved!.emails]] as const) {
        for (const value of [null, {}, [], true, 1, "bad", { ...valid as object, unknown: true }]) {
          expect(schema.safeParse(value).success).toBe(false);
          expect((await q.query<{ ok: boolean }>(`select ${name}($1::jsonb) ok`, [JSON.stringify(value)]))[0]!.ok).toBe(false);
        }
        expect((await q.query<{ ok: boolean }>(`select ${name}(null) ok`))[0]!.ok).toBe(false);
        expect((await q.query<{ ok: boolean }>(`select ${name}($1::jsonb) ok`, [JSON.stringify(valid)]))[0]!.ok).toBe(true);
      }
      for(const privacy of [null,{}, {guestList:null},{guestList:"everyone"},{guestList:"names",unknown:true}]) {
        expect((await q.query<{ok:boolean}>("select event_cover_v1_ok($1::jsonb) ok",[JSON.stringify({kind:"theme",theme:"sky",privacy})]))[0]!.ok).toBe(false);
      }
      await expect(q.query("update accounts set email_verified_at=now(),email_proof_ref='missing-method' where id=$1", [unproven])).rejects.toThrow("accounts_email_proof");
      await expect(q.query("update events set cover=$2::jsonb where id=$1", [event, JSON.stringify({ kind: "asset", version: randomUUID(), alt: "Missing" })])).rejects.toThrow("event_cover_asset_ownership");
      await expect(q.query("update event_policies set version=2 where event_id=$1", [event])).rejects.toThrow("event_policy_immutable");
      await expect(q.query("update verifications set vendor_data='other@example.test' where id=$1", [verification])).rejects.toThrow("verification_session_mapping_mismatch");
      const names = (await q.query<{ tgname: string }>("select tgname from pg_trigger where not tgisinternal")).map(r => r.tgname);
      for (const name of ["onboarding_guard_v2", "registration_submission_guard_v2", "submission_latest_guard_v2", "verification_mapping_guard_v2", "event_policy_guard_v2"]) expect(names).toContain(name);
    } finally { await fixture.close(); await rm(dir, { recursive: true, force: true }); }
  }, 90_000);
});
