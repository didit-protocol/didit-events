import "../testing/b4";

import { admissionService,authService,eventService,inviteService } from "@didit-events/core";
import { queryable } from "@didit-events/core/db/tx";
import { randomToken,signToken } from "@didit-events/core/identity/shared";
import { beforeEach,expect,it,vi } from "vitest";
import { requestFixture } from "../../../../packages/core/src/testing/model.ts";
import { GET as exportCsv } from "../../app/admin/(events)/events/[id]/(tabs)/guests/export/route";
import { POST as importCsv } from "../../app/api/admin/events/[id]/import/route";
import { GET as live } from "../../app/api/admin/events/[id]/live/route";
import { GET as stream } from "../../app/api/admin/events/[id]/stream/route";
import { acceptInvite,getInvite } from "../../app/i/[token]/data";
import { csrfToken } from "../auth/browser";
import { auth,databaseSuite } from "../testing/b4";
const state = databaseSuite(), url = "https://events.example.test";
const secret = "b4-csv-test-secret-longer-than-32-characters", cookie = signToken(randomToken(), secret, "session"), csrf = csrfToken(cookie, secret);
const params = () => ({ params: Promise.resolve({ id: state.eventId }) });
const request = (body: string, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin: url, "content-type": "text/csv", cookie: `__Host-sid=${cookie}; __Host-csrf=${csrf}`, "x-csrf": csrf, ...headers }, body });
beforeEach(() => { vi.stubEnv("APP_URL", url); vi.stubEnv("SESSION_SECRET", secret); vi.spyOn(authService, "requireStaff").mockImplementation(async () => auth.staff!); });
it("CSV import rejects the entire invalid file, bounds input with C14, then exports neutralized cells from DB", async () => {
  expect((await importCsv(request("first,last,email\nGood,Person,good@example.test\nBad,Person,invalid"), params())).status).toBe(400);
  expect(await queryable(state.db).query("select count(*)::int n from invites")).toEqual([{ n: 0 }]);
  expect((await importCsv(request("first,email\nA,a@example.test", { "x-csrf": "wrong" }), params())).status).toBe(403);
  expect((await importCsv(request("x".repeat(65537)), params())).status).toBe(413);
  const imported = await importCsv(request('first,last,email\n"=2+2",Person,formula@example.test\n"=2+2",Person,formula@example.test'), params());
  expect(await imported.json()).toEqual({ invited: 1, waitlisted: 0, alreadyRequested: 0 });
  expect(await queryable(state.db).query("select count(*)::int n from invites")).toEqual([{ n: 1 }]);
  const rows = await queryable(state.db).query("select admission,application->>'fullName' name from registrations where account_id<>$1", [state.accountId]);
  expect(rows).toEqual([]); // CSV creates an invitation; only the guest can complete checks and request a seat.
  await queryable(state.db).query("update accounts set first_name='=2+2',last_name='Person',full_name='=2+2 Person' where id=$1",[state.accountId]);
  await admissionService.transition(auth.staff!,state.registrationId,"approved");
  const exported = await exportCsv(new Request(url), params());
  expect(await exported.text()).toContain("'=2+2 Person");
  expect(await queryable(state.db).query("select count(*)::int n from outbox where kind='email:M-19'")).toEqual([{ n: 1 }]);
  expect(await queryable(state.db).query("select count(*)::int n from spend")).toEqual([{ n: 0 }]);
});
it("live endpoint returns the full authoritative snapshot, including undo/removal", async () => {
  await admissionService.transition(auth.staff!, state.registrationId, "approved");
  const q = queryable(state.db);
  await q.query("insert into checkins(event_id,registration_id,method) values($1,$2,'manual')", [state.eventId, state.registrationId]);
  const first = await (await live(new Request(url), params())).json();
  expect(first.registrations).toHaveLength(1); expect(first.checkins).toHaveLength(1); expect(first.checkins[0].undoneAt).toBeNull();
  await q.query("update checkins set undone_at=clock_timestamp(),updated_at=clock_timestamp() where event_id=$1", [state.eventId]);
  const second = await (await live(new Request(url + "?after=2099-01-01"), params())).json();
  expect(second.registrations).toHaveLength(1); expect(second.checkins[0].undoneAt).not.toBeNull();
  await eventService.delete(auth.staff!, state.eventId);
  expect((await live(new Request(url), params())).status).toBe(404);
});
it("SSE emits only change signals after committed DB transitions and closes on abort", async () => {
  const controller = new AbortController();
  const response = await stream(new Request(url, { signal: controller.signal }), params()), reader = response.body!.getReader();
  const signal = async () => {
    const { value, done } = await reader.read(); expect(done).toBe(false);
    const text = new TextDecoder().decode(value); return JSON.parse(text.trim().replace(/^data: /, ""));
  };
  try {
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    let s = await signal(); expect(Object.keys(s).sort()).toEqual(["event_id", "type"]);
    if (s.type === "reconnect") s = await signal();
    expect(s).toEqual({ type: "connected", event_id: state.eventId });
    await admissionService.transition(auth.staff!, state.registrationId, "waitlisted");
    expect(await signal()).toEqual({ type: "admission", event_id: state.eventId });
    expect(await queryable(state.db).query("select admission from registrations where id=$1", [state.registrationId])).toEqual([{ admission: "waitlisted" }]);
  } finally { controller.abort(); await reader.cancel(); }
});
it("invite page and acceptance enforce email binding and idempotent redemption after its final use", async () => {
  const event = (await eventService.get(state.otherId))!;
  const input=await requestFixture(state.db,auth.guest!,event.id);
  const link = await inviteService.create(auth.staff!, { eventId: event.id, email: "ana@example.test", maxUses: 1, expiresAt: event.startsAt, message: "Please join us" });
  expect((await getInvite(link.token)).view).toMatchObject({ state: "accepted", message: "Please join us" });
  expect(await acceptInvite(link.token,input)).toEqual({ slug: event.slug });
  expect((await getInvite(link.token)).view.state).toBe("accepted");
  expect(await acceptInvite(link.token,input)).toEqual({ slug: event.slug });
  expect(await queryable(state.db).query("select uses from invites")).toEqual([{ uses: 1 }]);
  const wrong = await inviteService.create(auth.staff!, { eventId: event.id, email: "wrong@example.test", maxUses: 1, expiresAt: event.startsAt });
  expect((await getInvite(wrong.token)).view.state).toBe("wrong_account");
  expect(await acceptInvite(wrong.token,input)).toEqual({ error: "wrong_account" });
  expect(await queryable(state.db).query("select uses from invites where id=$1", [wrong.invite.id])).toEqual([{ uses: 0 }]);
});
