// M-03 / M-13 registration email handlers: every suppression branch and the M-13 payload mapping.
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import type { Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import { OutboxRegistry,PermanentOutboxError,type OutboxMessage } from "../outbox.ts";
import { resetDatabase,testDatabase } from "../testing/database.ts";
import { startFakeResend,type FakeResend } from "./fake-resend.ts";
import { registerRegistrationEmails } from "./registration.ts";

const HOUR = 3600_000;
describe("registration emails (pglite)", () => {
  let db: Db, close: () => Promise<void>, resend: FakeResend, registry: OutboxRegistry;
  beforeAll(async () => { ({ db, close } = await testDatabase("pglite")); resend = await startFakeResend(); }, 60_000);
  beforeEach(async () => {
    await resetDatabase(db); resend.reset(); registry = new OutboxRegistry();
    registerRegistrationEmails(registry, { baseUrl: "https://events.example.test", resend: { apiKey: "re_test", apiUrl: resend.url }, db });
  });
  afterAll(async () => { await resend?.close(); await close?.(); });
  const q = () => queryable(db);

  async function setup(o: { admission?: string; status?: string; endsIn?: number; welcome?: unknown; arrival?: string; checkedIn?: boolean; undone?: boolean; agenda?: unknown } = {}) {
    const account = randomUUID(), event = randomUUID();
    await q().query("insert into accounts (id,email,first_name) values ($1,$2,'Ana')", [account, `${account}@example.test`]);
    await q().query(`insert into events (id,slug,name,starts_at,ends_at,capacity,status,venue,address,agenda,email_content,welcome_options,timezone)
      values ($1,$2,'AI Era',$3,$4,50,$5,'Didit HQ','Carrer de Pallars 99',$6::jsonb,$7::jsonb,$8::jsonb,'Europe/Madrid')`,
    [event, `ev-${event.slice(0, 8)}`, new Date(Date.now() - HOUR), new Date(Date.now() + (o.endsIn ?? 3 * HOUR)), o.status ?? "live",
      JSON.stringify(o.agenda ?? [{ at: "2026-10-08T17:00:00Z", label: "Panel" }, { label: "no time" }]),
      JSON.stringify(o.arrival === undefined ? {} : { arrivalNote: o.arrival }), JSON.stringify(o.welcome ?? null)]);
    const welcome=o.welcome as {welcomeEmail?:boolean;welcome?:{block?:string}}|undefined;
    await q().query("update events set emails=$2::jsonb where id=$1",[event,JSON.stringify({version:1,templates:{'M-13':{enabled:welcome?.welcomeEmail!==false,...(o.arrival||welcome?.welcome?.block?{body_md:o.arrival??welcome?.welcome?.block}:{})}}})]);
    const [r] = await q().query<{ id: string }>("insert into registrations(legacy_imported,policy_version,form_version,event_id,account_id,admission) values(true,1,1,$1,$2,$3) returning id", [event, account, o.admission ?? "approved"]);
    if (o.checkedIn !== false) await q().query("insert into checkins (event_id,registration_id,method,undone_at) values ($1,$2,'manual',$3)", [event, r!.id, o.undone ? new Date() : null]);
    return r!.id;
  }
  const run = (code: "M-03" | "M-13", registrationId: unknown): Promise<unknown> => {
    const message = { id: randomUUID(), kind: code, dedupe_key: `${code}:${String(registrationId)}`, payload: { registrationId }, attempts: 0 } as OutboxMessage;
    return registry.get(code)!(message, { signal: new AbortController().signal });
  };
  const permanent = async (p: Promise<unknown>, code: string) => { await expect(p).rejects.toBeInstanceOf(PermanentOutboxError); await expect(p).rejects.toMatchObject({ code }); };

  it("rejects malformed registration ids for both codes", async () => {
    await permanent(run("M-03", "nope"), "invalid_registration");
    await permanent(run("M-13", 42), "invalid_registration");
    expect(resend.calls).toHaveLength(0);
  });
  it("suppresses unknown, non-approved and cancelled-event registrations", async () => {
    await permanent(run("M-13", randomUUID()), "suppressed_registration");
    await permanent(run("M-13", await setup({ admission: "waitlisted" })), "suppressed_registration");
    await permanent(run("M-03", await setup({ status: "cancelled" })), "suppressed_registration");
    expect(resend.calls).toHaveLength(0);
  });
  it("M-03 is suppressed once the event has ended", async () => {
    await permanent(run("M-03", await setup({ endsIn: -60_000 })), "event_ended");
    expect(resend.calls).toHaveLength(0);
  });
  it("M-13 is suppressed when the check-in was undone or never happened", async () => {
    await permanent(run("M-13", await setup({ undone: true })), "checkin_undone");
    await permanent(run("M-13", await setup({ checkedIn: false })), "checkin_undone");
    expect(resend.calls).toHaveLength(0);
  });
  it("M-13 is suppressed when the host turned the welcome email off", async () => {
    await permanent(run("M-13", await setup({ welcome: { welcomeEmail: false } })), "suppressed_event_template");
    expect(resend.calls).toHaveLength(0);
  });
  it("M-13 sends once with the arrival note (or the welcome block, or the default) and only timed agenda items", async () => {
    await run("M-13", await setup({ arrival: "Wi-Fi: didit-guest" }));
    await run("M-13", await setup({ welcome: { welcome: { block: "Coats on the left" } } }));
    await run("M-13", await setup({}));
    expect(resend.calls).toHaveLength(3);
    const bodies = resend.calls.map(c => JSON.stringify(c.body));
    expect(bodies[0]).toContain("Wi-Fi: didit-guest");
    expect(bodies[1]).toContain("Coats on the left");
    expect(bodies[2]).toContain("Enjoy the event.");
    expect(bodies[0]).toContain("Panel");
    expect(bodies[0]).not.toContain("no time");
  });
});
