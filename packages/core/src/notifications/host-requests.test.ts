// Lane H: host emails on a new request (M-25) and the burst digest (M-26): trigger idempotency, recipients,
// send-time content and the batch guard.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { Requests } from "../admission/requests.ts";
import { registrationBy } from "../admission/shared.ts";
import type { Db } from "../db/index.ts";
import { queryable,withTx } from "../db/tx.ts";
import type { OutboxMessage } from "../outbox.ts";
import { resetDatabase,testDatabase } from "../testing/database.ts";
import { guestFixture,requestFixture } from "../testing/model.ts";
import { emailHandler } from "./email.ts";
import { startFakeResend,type FakeResend } from "./fake-resend.ts";
import { hostDigestData } from "./host-request-data.ts";
import { HOST_EMAIL_BURST,digestWindow,hostRecipients,notifyHostsOfRequest } from "./host-requests.ts";
import { DIGEST_PHOTOS,INLINE_PHOTO_MAX_BYTES,compressPhoto } from "./inline-photo.ts";

const BASE = "https://events.example.test", QUESTION = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
describe("host request emails (pglite)", () => {
  let db: Db, close: () => Promise<void>, resend: FakeResend;
  beforeAll(async () => { ({ db, close } = await testDatabase("pglite")); resend = await startFakeResend(); }, 60_000);
  beforeEach(async () => { await resetDatabase(db); resend.reset(); });
  afterAll(async () => { await resend?.close(); await close?.(); });
  const q = () => queryable(db);

  async function setupEvent(o: { speakers?: unknown[]; creator?: string | null; capacity?: number } = {}) {
    const event = randomUUID();
    const form = { version: 1, mode: "request", closes_at: null, waitlist: true, fields: { phone_number: "off" }, questions: [{ id: QUESTION, kind: "long", label: "What are you building?", required: true }], consent_text: null };
    await q().query(`insert into events (id,slug,name,starts_at,ends_at,capacity,status,venue,address,timezone,speakers,form)
      values ($1,$2,'AI Era',clock_timestamp()+interval '1 day',clock_timestamp()+interval '25 hours',$5,'published','Didit HQ','Carrer de Pallars 99, Barcelona','Europe/Madrid',$3::jsonb,$4::jsonb)`,
    [event, `ev-${event.slice(0, 8)}`, JSON.stringify(o.speakers ?? []), JSON.stringify(form), o.capacity ?? 10]);
    if (o.creator !== null) await q().query("insert into audit(event_id,actor,action,target) values($1::uuid,$2,'event.create',$1::text)", [event, o.creator ?? "creator@didit.me"]);
    return event;
  }
  async function staff(...rows: [string, string?, boolean?][]) {
    for (const [email, role = "staff", disabled = false] of rows) await q().query("insert into staff(email,role,disabled_at) values($1,$2,$3)", [email, role, disabled ? new Date() : null]);
  }
  /** A real guest request through Requests.submitRequest (the hook point), with a full profile and one answer. */
  async function submit(event: string, name = "Ana Gómez", joinWaitlist = false) {
    const guest = await guestFixture(db);
    await q().query("update accounts set full_name=$2,headline='Builder of things',company='Acme',job_role='Founder',profile_links=$3::jsonb where id=$1",
      [guest.accountId, name, JSON.stringify([{ kind: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/in/ana" }, { kind: "website", label: "Site", href: "https://ana.example" }])]);
    const input = { ...await requestFixture(db, guest, event, joinWaitlist), application: { fields: {}, answers: { [QUESTION]: "Event software" } } };
    const saved = await new Requests(db).submitRequest(guest, event, input);
    return { id: saved.registration.id, admission: saved.registration.admission, accountId: guest.accountId, replay: () => new Requests(db).submitRequest(guest, event, input) };
  }
  const notify = (registrationId: string, now = new Date()) => withTx(async tx => notifyHostsOfRequest(tx, await registrationBy(tx, registrationId), { id: (await registrationBy(tx, registrationId)).eventId }, now), db);
  const rows = (kind: string) => q().query<OutboxMessage & { next_attempt_at: Date } & Record<string, unknown>>("select * from outbox where kind=$1 order by dedupe_key", [kind]);
  const dispatch = (row: OutboxMessage) => emailHandler({ baseUrl: BASE, resend: { apiKey: "re_test", apiUrl: resend.url }, db })(row, { signal: new AbortController().signal });

  it("recipients: active staff hosts plus the creator, de-duplicated, never the guest or disabled/non-staff hosts", async () => {
    await staff(["host@didit.me"], ["creator@didit.me"], ["off@didit.me", "staff", true], ["guest@didit.me"], ["owner@didit.me", "owner"]);
    const event = await setupEvent({ speakers: [{ name: "Host", role: "", email: "host@didit.me" }, { name: "Again", role: "", email: "Creator@didit.me" }, { name: "Off", role: "", email: "off@didit.me" },
      { name: "Outside", role: "", email: "someone@example.com" }, { name: "Guest", role: "", email: "guest@didit.me" }, { name: "No email", role: "" }] });
    expect(await hostRecipients(q(), event, "guest@didit.me")).toEqual(["creator@didit.me", "host@didit.me"]);
  });
  it("recipients: with no host staff and no creator, the calendar owners", async () => {
    await staff(["owner@didit.me", "owner"], ["owner2@didit.me", "owner", true], ["admin@didit.me", "admin"]);
    const event = await setupEvent({ speakers: [{ name: "Outside", role: "", email: "someone@example.com" }], creator: null });
    expect(await hostRecipients(q(), event, "x@example.test")).toEqual(["owner@didit.me"]);
  });

  it("a guest request queues one M-25 To the first host with the other hosts in CC: a replayed submit or a repeated call adds nothing", async () => {
    await staff(["host@didit.me"], ["creator@didit.me"]);
    const event = await setupEvent({ speakers: [{ name: "Host", role: "", email: "host@didit.me" }] }), r = await submit(event);
    expect(r.admission).toBe("pending");
    expect((await r.replay()).replayed).toBe(true);
    await notify(r.id);
    const queued = await rows("email:M-25");
    expect(queued.map(x => x.dedupe_key)).toEqual([`email:M-25:${event}:${r.id}:0:hosts`]);
    expect(queued.map(x => x.payload)).toEqual([
      { code: "M-25", to: "creator@didit.me", cc: ["host@didit.me"], eventId: event, data: { registrationId: r.id, kind: "request", reapplicationCount: 0 } }]);
    // The team mailbox is Reply-To only: it is never a recipient, even when it is a staff member or the only owner.
    await staff(["events@didit.me", "owner"]);
    await q().query("update events set speakers=speakers||$2::jsonb where id=$1", [event, JSON.stringify([{ name: "Inbox", role: "", email: "events@didit.me" }])]);
    expect(await hostRecipients(q(), event, "x@example.test")).toEqual(["creator@didit.me", "host@didit.me"]);
    await q().query("delete from staff where email<>'events@didit.me'");
    expect(await hostRecipients(q(), event, "x@example.test")).toEqual([]);
    expect((await q().query("select payload from outbox where kind='email:M-02'"))).toHaveLength(1); // the guest's own receipt is unchanged
  });
  it("queues nothing for a registration that is not pending or waitlisted", async () => {
    await staff(["creator@didit.me"]);
    const event = await setupEvent(), r = await submit(event);
    await q().query("delete from outbox where kind='email:M-25'");
    await q().query("update registrations set admission='approved' where id=$1", [r.id]);
    expect(await notify(r.id)).toBe(0);
    expect(await rows("email:M-25")).toHaveLength(0);
  });

  it("renders the request for the host with the review URL and no biometric data", async () => {
    await staff(["creator@didit.me"]);
    const event = await setupEvent(), r = await submit(event, "Ana Gómez");
    const [row] = await rows("email:M-25");
    expect(await dispatch(row!)).toEqual({ providerId: "re_1" });
    const [call] = resend.calls, body = call!.body as { to: string[]; cc: string[]; from: string; reply_to: string; subject: string; html: string; text: string };
    expect(call!.headers["idempotency-key"]).toBe(row!.dedupe_key);
    expect(body.to).toEqual(["creator@didit.me"]); // a single host: To, no CC
    expect(body).not.toHaveProperty("cc");
    expect(body).not.toHaveProperty("bcc");
    expect(body.from).toBe("Didit Events <events@updates.didit.me>");
    expect(body.reply_to).toBe("events@example.com");
    expect(body.subject).toBe("New request: Ana Gómez for AI Era");
    expect(body.html).toContain(`href="${BASE}/admin/events/${event}/applicants?applicant=${r.id}"`);
    expect(body.html).toContain(`href="${BASE}/admin/events/${event}/applicants"`);
    expect(body.html).toContain("Verified by Didit");
    expect(body.html).toContain(">AG</td>"); // no stored photo: initials, and nothing attached
    expect(body).not.toHaveProperty("attachments");
    expect(body.html).not.toMatch(/selfie|liveness|biometric|\/photo/i);
    expect(body.text.replace(/applicant=[0-9a-f-]+|events\/[0-9a-f-]+/g, "<id>").replace(/Requested: .*/, "Requested: <now>").replace(/Email: .*@example\.test/, "Email: <guest>")).toMatchSnapshot();
  });
  it("announces a waitlist entry and suppresses a request decided, or a recipient disabled, before sending", async () => {
    await staff(["creator@didit.me"]);
    const event = await setupEvent({ capacity: 1 }), first = await submit(event, "Dee Cided");
    await q().query("update registrations set admission='approved' where id=$1", [first.id]);
    const waitlisted = await submit(event, "Wai Lee", true);
    expect(waitlisted.admission).toBe("waitlisted");
    const queued = await rows("email:M-25"), forWaitlisted = queued.find(x => x.dedupe_key.includes(waitlisted.id))!, forDecided = queued.find(x => x.dedupe_key.includes(first.id))!;
    expect(forWaitlisted.payload).toMatchObject({ data: { kind: "waitlist" } });
    await dispatch(forWaitlisted);
    expect(resend.calls[0]!.body.subject).toBe("New request: Wai Lee for AI Era (waitlist)");
    expect(resend.calls[0]!.body.text).toContain("Wai Lee joined the waitlist");
    expect(resend.calls[0]!.body.text).toContain("Places left: 0 of 1");
    await expect(dispatch(forDecided)).rejects.toMatchObject({ code: "suppressed_registration" });
    await q().query("update staff set disabled_at=now() where email='creator@didit.me'");
    await expect(dispatch(forWaitlisted)).rejects.toMatchObject({ code: "suppressed_staff" });
    expect(resend.calls).toHaveLength(1);
  });

  it("send time: a disabled host is dropped (To moves to the next host), the guest is never a recipient, all hosts disabled → suppressed", async () => {
    await staff(["host@didit.me"], ["creator@didit.me"], ["second@didit.me"]);
    const event = await setupEvent({ speakers: [{ name: "Host", role: "", email: "host@didit.me" }, { name: "Second", role: "", email: "second@didit.me" }] }), r = await submit(event);
    const [row] = await rows("email:M-25");
    expect(row!.payload).toMatchObject({ to: "creator@didit.me", cc: ["host@didit.me", "second@didit.me"] });
    const stored = () => structuredClone(row!); // the handler re-seats To/CC on the payload it is given
    const guest = (await q().query<{ email: string }>("select a.email from registrations r join accounts a on a.id=r.account_id where r.id=$1", [r.id]))[0]!.email;
    await q().query("insert into staff(email,role) values($1,'staff')", [guest]); // the guest is staff too, and slipped into a stored CC
    await q().query("update staff set disabled_at=now() where email='host@didit.me'");
    const withGuest = { ...stored(), payload: { ...(row!.payload as { cc: string[] }), cc: [...(row!.payload as { cc: string[] }).cc, guest] } } as OutboxMessage;
    expect(await dispatch(withGuest)).toEqual({ providerId: "re_1" });
    expect(resend.calls[0]!.body).toMatchObject({ to: ["creator@didit.me"], cc: ["second@didit.me"], reply_to: "events@example.com" });
    // The host in To is disabled: the next active host takes To, and a lone recipient has no CC.
    await q().query("update staff set disabled_at=now() where email='creator@didit.me'");
    await dispatch(stored());
    expect(resend.calls[1]!.body.to).toEqual(["second@didit.me"]);
    expect(resend.calls[1]!.body).not.toHaveProperty("cc");
    await q().query("update staff set disabled_at=now() where email='second@didit.me'");
    await expect(dispatch(stored())).rejects.toMatchObject({ code: "suppressed_staff" });
    expect(resend.calls).toHaveLength(2);
  });
  it("a row queued before 2026-10-02 (events inbox in To, hosts in CC) goes To the hosts: the inbox is Reply-To only", async () => {
    await staff(["host@didit.me"], ["creator@didit.me"], ["events@didit.me"]);
    const event = await setupEvent({ speakers: [{ name: "Host", role: "", email: "host@didit.me" }] }), r = await submit(event);
    const [row] = await rows("email:M-25");
    const old = (cc: string[]) => ({ ...row!, payload: { code: "M-25", to: "events@didit.me", cc, eventId: event, data: { registrationId: r.id, kind: "request", reapplicationCount: 0 } } }) as OutboxMessage;
    expect(await dispatch(old(["creator@didit.me", "host@didit.me", "Events@didit.me", "host@didit.me"]))).toEqual({ providerId: "re_1" });
    const body = resend.calls[0]!.body as { to: string[]; cc: string[]; reply_to: string };
    expect(body).toMatchObject({ to: ["creator@didit.me"], cc: ["host@didit.me"], reply_to: "events@example.com" });
    expect(JSON.stringify([body.to, body.cc, (body as { bcc?: unknown }).bcc ?? null])).not.toContain("events@didit.me");
    await q().query("update staff set disabled_at=now() where email in ('creator@didit.me','host@didit.me')");
    await expect(dispatch(old(["creator@didit.me", "host@didit.me"]))).rejects.toMatchObject({ code: "suppressed_staff" }); // never the inbox alone
    expect(resend.calls).toHaveLength(1);
  });
  it("a row with one host in `to` and no CC keeps the per-recipient checks", async () => {
    await staff(["creator@didit.me"]);
    const event = await setupEvent(), r = await submit(event);
    const [row] = await rows("email:M-25");
    const legacy = { ...row!, dedupe_key: `email:M-25:${event}:${r.id}:0:creator@didit.me`, payload: { code: "M-25", to: "creator@didit.me", eventId: event, data: { registrationId: r.id, kind: "request", reapplicationCount: 0 } } } as OutboxMessage;
    expect(await dispatch(legacy)).toEqual({ providerId: "re_1" });
    expect(resend.calls[0]!.body.to).toEqual(["creator@didit.me"]);
    expect(resend.calls[0]!.body).not.toHaveProperty("cc");
    await q().query("update staff set disabled_at=now() where email='creator@didit.me'");
    await expect(dispatch(legacy)).rejects.toMatchObject({ code: "suppressed_staff" });
  });

  it("withdraw and re-apply is announced once: the earlier application's notice is suppressed at send time", async () => {
    await staff(["creator@didit.me"]);
    const event = await setupEvent(), guest = await guestFixture(db);
    const input = async () => ({ ...await requestFixture(db, guest, event), application: { fields: {}, answers: { [QUESTION]: "Event software" } } });
    const first = await new Requests(db).submitRequest(guest, event, await input());
    const [early] = await rows("email:M-25");
    expect(early!.payload).toMatchObject({ data: { registrationId: first.registration.id, reapplicationCount: 0 } });
    await new Requests(db).withdrawOrCancel(guest, first.registration.id, { expectedAdmission: "pending" });
    // The withdrawal retires the still-queued notice (like the guest's own pending emails).
    expect(await q().query("select status,provider_id,payload from outbox where id=$1", [early!.id])).toEqual([{ status: "sent", provider_id: "cancelled:withdrawal", payload: null }]);
    const again = await new Requests(db).submitRequest(guest, event, await input());
    expect(again.registration).toMatchObject({ id: first.registration.id, admission: "pending" });
    expect(await q().query("select reapplication_count n from registrations where id=$1", [first.registration.id])).toEqual([{ n: 1 }]);
    const queued = await rows("email:M-25"), late = queued.find(x => x.id !== early!.id)!;
    expect(queued.map(x => x.dedupe_key)).toEqual([`email:M-25:${event}:${first.registration.id}:0:hosts`, `email:M-25:${event}:${first.registration.id}:1:hosts`]);
    // The worker reaches the first notice only now (lag, retry): the registration is open again, but not for that application.
    await expect(dispatch(early!)).rejects.toMatchObject({ code: "suppressed_registration" });
    expect(await dispatch(late)).toEqual({ providerId: "re_1" });
    expect(resend.calls).toHaveLength(1);
    // A notice queued before the count was stored (no reapplicationCount) keeps the open-admission check alone.
    const legacy = { ...early!, payload: { ...(early!.payload as { data: object }), data: { registrationId: first.registration.id, kind: "request" } } } as OutboxMessage;
    expect(await dispatch(legacy)).toEqual({ providerId: expect.any(String) });
    await q().query("update registrations set admission='approved' where id=$1", [first.registration.id]);
    await expect(dispatch(legacy)).rejects.toMatchObject({ code: "suppressed_registration" });
  });

  it("batch guard: past 10 requests in 10 minutes the rest arrive as one digest To the first host, the others in CC", async () => {
    await staff(["creator@didit.me"], ["host@didit.me"]);
    const left = digestWindow(new Date()).end.getTime() - Date.now();
    if (left < 30_000) await new Promise(resolve => setTimeout(resolve, left + 100)); // keep the burst inside one 10-minute bucket
    const event = await setupEvent({ speakers: [{ name: "Host", role: "", email: "host@didit.me" }], capacity: 50 }), ids: string[] = [];
    for (let i = 0; i < HOST_EMAIL_BURST + 3; i++) ids.push((await submit(event, `Guest ${String(i).padStart(2, "0")}`)).id);
    expect(await rows("email:M-25")).toHaveLength(HOST_EMAIL_BURST); // one single notice per request, burst counted per registration
    const digests = await rows("email:M-26"), window = digestWindow(new Date());
    expect(digests.map(x => x.dedupe_key)).toEqual([`email:M-26:${event}:${window.start.getTime()}:hosts`]);
    expect(digests[0]!.payload).toMatchObject({ to: "creator@didit.me", cc: ["host@didit.me"] });
    expect(digests[0]!.next_attempt_at.getTime()).toBe(window.end.getTime());
    await dispatch(digests[0]!);
    const body = resend.calls[0]!.body as { to: string[]; cc: string[]; subject: string; text: string; html: string };
    expect(body.to).toEqual(["creator@didit.me"]);
    expect(body.cc).toEqual(["host@didit.me"]);
    expect((body as unknown as { reply_to: string }).reply_to).toBe("events@example.com");
    expect(body.subject).toBe("3 new requests for AI Era");
    expect(body.text).toContain("Guest 10"); expect(body.text).toContain("Guest 12"); expect(body.text).not.toContain("Guest 09");
    expect(body.text).toContain("Pending: 13 requests");
    expect(body.html).toContain(`href="${BASE}/admin/events/${event}/applicants"`);
    // Folded requests decided before the window closes are not listed; with none left the digest is suppressed.
    await q().query("update registrations set admission='rejected' where id = any($1::uuid[])", [ids.slice(HOST_EMAIL_BURST)]);
    await expect(dispatch(digests[0]!)).rejects.toMatchObject({ code: "suppressed_no_requests" });
  });
  /** A 512×512 JPEG with EXIF, like a stored profile photo. */
  const storedPhoto = async (seed = 0) => new Uint8Array(await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 180 - seed, g: 120, b: 90 + seed } } })
    .composite([{ input: { create: { width: 200, height: 260, channels: 3, background: "#3a2a20" } }, top: 120, left: 156 }])
    .withExif({ IFD0: { Artist: "secret-owner", Copyright: "exif" } }).jpeg({ quality: 90 }).toBuffer());
  type Sent = { html: string; text: string; attachments?: { filename: string; content: string; content_type: string; content_id?: string }[] };

  it("photo: the stored profile photo travels inline (cid + attachment, 96×96 JPEG ≤ 8 KB, no metadata), never as a URL", async () => {
    await staff(["creator@didit.me"]);
    const event = await setupEvent(), r = await submit(event, "Ana Gómez");
    await q().query("update accounts set photo=$2,photo_url='/api/me/photo' where id=$1", [r.accountId, await storedPhoto()]);
    const [row] = await rows("email:M-25");
    await dispatch(row!);
    const body = resend.calls[0]!.body as unknown as Sent;
    expect(body.html).toMatch(/<img src="cid:applicant-1" width="48" height="48" alt="Ana Gómez" style="[^"]*border-radius:50%/);
    expect(body.html).not.toContain(">AG</td>");
    expect(body.html).not.toMatch(/\/api\/me\/photo|https?:\/\/[^"]*photo/);
    expect(body.attachments).toHaveLength(1);
    const [photo] = body.attachments!;
    expect(photo).toMatchObject({ filename: "applicant-1.jpg", content_type: "image/jpeg", content_id: "applicant-1" });
    const bytes = Buffer.from(photo!.content, "base64");
    expect(bytes.byteLength).toBeLessThanOrEqual(INLINE_PHOTO_MAX_BYTES);
    const meta = await sharp(bytes).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 96, height: 96 });
    expect(meta.exif).toBeUndefined();
    expect(bytes.toString("latin1")).not.toContain("secret-owner");
  });
  it("photo: unreadable bytes fall back to initials and never fail the send", async () => {
    await staff(["creator@didit.me"]);
    const event = await setupEvent(), r = await submit(event, "Ana Gómez");
    await q().query("update accounts set photo=$2 where id=$1", [r.accountId, new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])]);
    const [row] = await rows("email:M-25");
    expect(await dispatch(row!)).toEqual({ providerId: "re_1" });
    const body = resend.calls[0]!.body as unknown as Sent;
    expect(body.html).toContain(">AG</td>");
    expect(body.html).not.toContain("cid:");
    expect(body).not.toHaveProperty("attachments");
    expect(await compressPhoto(null)).toBeNull();
  });
  it("photo: a deleted account is never announced and its photo never read", async () => {
    await staff(["creator@didit.me"]);
    const event = await setupEvent(), r = await submit(event, "Ana Gómez");
    await q().query("update accounts set photo=$2,deleting_at=clock_timestamp() where id=$1", [r.accountId, await storedPhoto()]);
    const [row] = await rows("email:M-25");
    await expect(dispatch(row!)).rejects.toMatchObject({ code: "suppressed_registration" });
    expect(resend.calls).toHaveLength(0);
  });
  it("digest: a host who applied is never listed in a digest they receive (To or CC)", async () => {
    await staff(["creator@didit.me"], ["host2@didit.me"]);
    const left = digestWindow(new Date()).end.getTime() - Date.now();
    if (left < 30_000) await new Promise(resolve => setTimeout(resolve, left + 100));
    const event = await setupEvent({ capacity: 50 });
    const other = await submit(event, "Guest A");
    const host = await submit(event, "Host Two");
    await q().query("update accounts set email='host2@didit.me' where id=$1", [host.accountId]);
    await q().query("delete from outbox where kind='email:M-25'");
    const window = digestWindow(new Date());
    const { data } = await hostDigestData(q(), { to: "creator@didit.me", cc: ["host2@didit.me"], eventId: event }, { windowStart: window.start, windowEnd: window.end }, BASE);
    const names = (data.requests as { name: string }[]).map(x => x.name);
    expect(names).toContain("Guest A");
    expect(names).not.toContain("Host Two");
    void other;
  });

  it("photo: the digest embeds at most 10 photos, the rest show initials; deleted accounts are left out", async () => {
    await staff(["creator@didit.me"]);
    const left = digestWindow(new Date()).end.getTime() - Date.now();
    if (left < 30_000) await new Promise(resolve => setTimeout(resolve, left + 100));
    const event = await setupEvent({ capacity: 50 }), guests: { id: string; accountId: string }[] = [];
    for (let i = 0; i < DIGEST_PHOTOS + 3; i++) guests.push(await submit(event, `Guest ${String(i).padStart(2, "0")}`));
    for (const [i, g] of guests.entries()) await q().query("update accounts set photo=$2 where id=$1", [g.accountId, await storedPhoto(i)]);
    await q().query("update accounts set deleting_at=clock_timestamp() where id=$1", [guests[0]!.accountId]);
    await q().query("delete from outbox where kind='email:M-25'"); // every request folds into the digest
    const window = digestWindow(new Date());
    const { data, inline } = await hostDigestData(q(), { to: "events@didit.me", cc: ["creator@didit.me"], eventId: event }, { windowStart: window.start, windowEnd: window.end }, BASE);
    const requests = data.requests as { name: string; photoUrl: string | null }[];
    expect(requests.map(x => x.name)).not.toContain("Guest 00");
    expect(requests).toHaveLength(DIGEST_PHOTOS + 2);
    expect(inline).toHaveLength(DIGEST_PHOTOS);
    expect(inline.map(x => x.content_id)).toEqual(Array.from({ length: DIGEST_PHOTOS }, (_, i) => `applicant-${i + 1}`));
    expect(requests.slice(0, DIGEST_PHOTOS).map(x => x.photoUrl)).toEqual(inline.map(x => `cid:${x.content_id}`));
    expect(requests.slice(DIGEST_PHOTOS).map(x => x.photoUrl)).toEqual([null, null]);
    for (const x of inline) expect(Buffer.from(x.content, "base64").byteLength).toBeLessThanOrEqual(INLINE_PHOTO_MAX_BYTES);
    const [digest] = await rows("email:M-26");
    await dispatch(digest!);
    const body = resend.calls[0]!.body as unknown as Sent;
    expect(body.attachments?.map(a => a.content_id)).toEqual(inline.map(x => x.content_id));
    expect(body.html.match(/src="cid:applicant-\d+"/g)).toHaveLength(DIGEST_PHOTOS);
    expect(body.html).toContain(">G1</td>"); // Guest 11, 12: initials
  });
});
