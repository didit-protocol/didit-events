import { staffEmailSql } from "../staff-email.ts";
import { audit,AdmissionError,database,eventBy,fail,read,requireEventActor,signal } from "../admission/shared.ts";
import { consume } from "../counters.ts";
import type { Db } from "../db/index.ts";
import { withTx,type Queryable,type Tx } from "../db/tx.ts";
import type { StaffPrincipal } from "../domain/services.ts";
import { enqueueEmail } from "../notifications/email.ts";
import { isEventRole,type EventRole } from "./capabilities.ts";

export interface EventMember {
  id: string; eventId: string; email: string; role: EventRole; invitedBy: string; createdAt: Date;
  /** The member's account name, once they have signed in at least once. */
  name: string | null;
  /** True when this address already reaches every event as Didit staff. */
  isStaff: boolean;
}
export interface Membership { eventId: string; role: EventRole }
type MemberRow = { id: string; event_id: string; email: string; role: EventRole; invited_by: string; created_at: Date; name: string | null; is_staff: boolean };

const memberEmail = (value: string) => {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(email)) fail("InvalidEmail");
  return email;
};
const toMember = (r: MemberRow): EventMember => ({ id: r.id, eventId: r.event_id, email: r.email, role: r.role, invitedBy: r.invited_by, createdAt: r.created_at, name: r.name, isStaff: r.is_staff });
const memberSelect = () => `select m.id,m.event_id,m.email,m.role,m.invited_by,m.created_at,
  nullif(concat_ws(' ',a.first_name,a.last_name),'') as name,
  exists(select 1 from staff t where t.email=m.email and t.disabled_at is null and ${staffEmailSql("t.email")}) as is_staff
  from event_members m left join accounts a on a.email=m.email and a.deleting_at is null and a.deleted_at is null`;

/** Active event memberships of an account email (no staff rows). Read by the admin request guard on every request. */
export async function membershipsFor(q: Queryable, email: string): Promise<Membership[]> {
  const rows = await q.query<{ event_id: string; role: EventRole }>("select event_id,role from event_members where email=$1 and revoked_at is null order by created_at", [email.trim().toLowerCase()]);
  return rows.map(r => ({ eventId: r.event_id, role: r.role }));
}

/** Event "Team" tab and the MCP `event_team_*` tools. Every method re-checks the actor through `requireEventActor`. */
export class EventTeam {
  constructor(private readonly db?: Db) {}
  private async eventId(q: Queryable, idOrSlug: string): Promise<string> {
    const event = await eventBy(q, idOrSlug);
    if (!event) return fail("EventNotFound");
    return event!.id;
  }
  async list(actor: StaffPrincipal, idOrSlug: string): Promise<EventMember[]> {
    const q = read(this.db), eventId = await this.eventId(q, idOrSlug);
    await requireEventActor(q, actor, eventId, "team.view");
    return (await q.query<MemberRow>(`${memberSelect()} where m.event_id=$1 and m.revoked_at is null order by m.role, m.created_at, m.id`, [eventId])).map(toMember);
  }
  /** Adds (or changes the role of) a member and emails the invitation. Re-adding the same role re-sends nothing. */
  async add(actor: StaffPrincipal, idOrSlug: string, rawEmail: string, role: string): Promise<{ member: EventMember; created: boolean; roleChanged: boolean }> {
    const email = memberEmail(rawEmail);
    if (!isEventRole(role)) fail("InvalidRole");
    return withTx(async tx => {
      const eventId = await this.eventId(tx, idOrSlug);
      await tx.query("select id from events where id=$1 for share", [eventId]);
      await requireEventActor(tx, actor, eventId, "team.manage", true);
      const [staff] = await tx.query(`select email from staff where email=$1 and disabled_at is null and ${staffEmailSql("email")}`, [email]);
      if (staff) fail("AlreadyStaff");
      const [existing] = await tx.query<{ id: string; role: EventRole }>("select id,role from event_members where event_id=$1 and email=$2 and revoked_at is null for update", [eventId, email]);
      let id: string, created = false, roleChanged = false;
      if (existing) {
        id = existing.id;
        if (existing.role !== role) {
          roleChanged = true;
          await tx.query("update event_members set role=$2,updated_at=clock_timestamp() where id=$1", [id, role]);
          await audit(tx, eventId, actor.email, "team.role", id, { email, from: existing.role, to: role });
        }
      } else {
        const [row] = await tx.query<{ id: string }>("insert into event_members(event_id,email,role,invited_by) values($1,$2,$3,$4) returning id", [eventId, email, role, actor.email]);
        id = row!.id; created = true;
        await audit(tx, eventId, actor.email, "team.add", id, { email, role });
      }
      if (created || roleChanged) await this.invitation(tx, actor, eventId, id, email, role as EventRole, created ? "new" : `role:${role}`);
      await signal(tx, eventId, "team");
      const [member] = await tx.query<MemberRow>(`${memberSelect()} where m.id=$1`, [id]);
      return { member: toMember(member!), created, roleChanged };
    }, database(this.db));
  }
  /** Ends access immediately: membership revoked and every door session the member started on this event ended. */
  async remove(actor: StaffPrincipal, idOrSlug: string, memberId: string): Promise<void> {
    await withTx(async tx => {
      const eventId = await this.eventId(tx, idOrSlug);
      await tx.query("select id from events where id=$1 for share", [eventId]);
      await requireEventActor(tx, actor, eventId, "team.manage", true);
      const [member] = await tx.query<{ email: string }>("select email from event_members where id=$1 and event_id=$2 and revoked_at is null for update", [memberId, eventId]);
      if (!member) fail("MemberNotFound");
      if (member!.email === actor.email) fail("CannotRemoveSelf");
      await tx.query("update event_members set revoked_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1", [memberId]);
      await tx.query("update door_sessions set ended_at=clock_timestamp(),ended_by=$3 where event_id=$1 and email=$2 and ended_at is null", [eventId, member!.email, `removed by ${actor.email}`]);
      await audit(tx, eventId, actor.email, "team.remove", memberId, { email: member!.email });
      await signal(tx, eventId, "team");
    }, database(this.db));
  }
  /** Sends the invitation again (3 per member per hour). */
  async resend(actor: StaffPrincipal, idOrSlug: string, memberId: string): Promise<void> {
    if (!(await consume(`team:resend:${memberId}`, 3, 3600, database(this.db))).allowed) throw new AdmissionError("ResendLimited");
    await withTx(async tx => {
      const eventId = await this.eventId(tx, idOrSlug);
      await requireEventActor(tx, actor, eventId, "team.manage");
      const [member] = await tx.query<{ email: string; role: EventRole }>("select email,role from event_members where id=$1 and event_id=$2 and revoked_at is null", [memberId, eventId]);
      if (!member) fail("MemberNotFound");
      await this.invitation(tx, actor, eventId, memberId, member!.email, member!.role, `resend:${Date.now()}`);
      await audit(tx, eventId, actor.email, "team.resend", memberId, { email: member!.email });
    }, database(this.db));
  }
  private async invitation(tx: Tx, actor: StaffPrincipal, eventId: string, memberId: string, email: string, role: EventRole, key: string) {
    const [inviter] = await tx.query<{ name: string | null }>("select nullif(concat_ws(' ',first_name,last_name),'') as name from accounts where email=$1", [actor.email]);
    const [event] = await tx.query<{ slug: string }>("select slug from events where id=$1", [eventId]);
    await enqueueEmail(tx, { code: "M-27", dedupeKey: `email:M-27:${memberId}:${key}`, to: email, eventId,
      data: { role, inviter: { name: inviter?.name ?? actor.email }, adminUrl: `/admin/events/${event!.slug}` } });
  }
}
export const eventTeam = new EventTeam();
