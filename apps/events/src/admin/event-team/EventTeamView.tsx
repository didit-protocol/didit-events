"use client";

import { useActionState } from "react";
import { Banner, Button, EmailField, Select, SubmitButton } from "@didit-events/ui";
import { EVENT_ROLE_SUMMARY } from "@didit-events/core/access/capabilities";
import { CsrfField } from "../../auth/CsrfField";
import type { TeamActionState, TeamMemberRow } from "./types";
import s from "./EventTeam.module.css";

const IDLE: TeamActionState = { status: "idle" };
const ROLE_LABEL = { host: "Host", operator: "Door operator" } as const;
type Act = (prev: TeamActionState, form: FormData) => Promise<TeamActionState>;

/**
 * The event Team tab: who runs this event besides Didit staff. Hosts manage everything on the event except cancelling
 * or deleting it and spend limits; door operators see the guest list and run the door. Anyone can be added by email:
 * they sign in with Google or an email code and only see this event.
 */
export function EventTeamView({ eventName, members, manage, self, add, remove, resend }: {
  eventName: string; members: TeamMemberRow[]; manage: boolean; self: string;
  add: Act; remove: (id: string, prev: TeamActionState, form: FormData) => Promise<TeamActionState>; resend: (id: string, prev: TeamActionState, form: FormData) => Promise<TeamActionState>;
}) {
  const [state, action] = useActionState(add, IDLE);
  return (
    <div className={s.page}>
      <section className={s.card} aria-labelledby="event-team-title">
        <h2 id="event-team-title" className={s.title}>Event team</h2>
        <p className={s.lead}>People who help run {eventName}. Didit staff can always open every event.</p>
        <ul className={s.roles}>
          <li><b>Host</b> · {EVENT_ROLE_SUMMARY.host}</li>
          <li><b>Door operator</b> · {EVENT_ROLE_SUMMARY.operator}</li>
        </ul>
        {manage ? (
          <form action={action} className={s.add} noValidate>
            <CsrfField />
            <EmailField key={state.status === "saved" ? state.message : "draft"} name="email" label="Add by email" placeholder="name@company.com" defaultValue={state.status === "error" ? state.email : undefined} required className={s.email} />
            <Select name="role" label="Role" defaultValue={state.status === "error" && state.role ? state.role : "operator"} options={[{ value: "operator", label: ROLE_LABEL.operator }, { value: "host", label: ROLE_LABEL.host }]} className={s.role} />
            <SubmitButton pendingLabel="Sending…">Send invite</SubmitButton>
          </form>
        ) : null}
        <div aria-live="polite">
          {state.status === "saved" ? <Banner tone="success">{state.message}</Banner> : state.status === "error" ? <Banner tone="danger">{state.message}</Banner> : null}
        </div>
      </section>
      <section className={s.card} aria-labelledby="event-team-list">
        <h2 id="event-team-list" className={s.title}>Members</h2>
        {members.length ? (
          <ul className={s.list}>
            {members.map((m) => <MemberRow key={m.id} member={m} manage={manage} self={m.email === self} remove={remove} resend={resend} />)}
          </ul>
        ) : (
          <p className={s.lead}>Nobody yet. Add a host or a door operator above.</p>
        )}
      </section>
    </div>
  );
}

function MemberRow({ member, manage, self, remove, resend }: {
  member: TeamMemberRow; manage: boolean; self: boolean;
  remove: (id: string, prev: TeamActionState, form: FormData) => Promise<TeamActionState>; resend: (id: string, prev: TeamActionState, form: FormData) => Promise<TeamActionState>;
}) {
  const [removed, removeAction, removing] = useActionState(remove.bind(null, member.id), IDLE);
  const [sent, resendAction, sending] = useActionState(resend.bind(null, member.id), IDLE);
  const status = removed.status !== "idle" ? removed : sent;
  return (
    <li className={s.member}>
      <span className={s.who}>
        <b>{member.name ?? member.email}</b>
        {member.name ? <span className={s.meta}>{member.email}</span> : null}
        <span className={s.meta}>{ROLE_LABEL[member.role]} · added {member.added} by {member.invitedBy}</span>
        {status.status !== "idle" ? <span className={status.status === "error" ? s.error : s.meta} role={status.status === "error" ? "alert" : "status"}>{status.message}</span> : null}
      </span>
      {manage ? (
        <span className={s.actions}>
          <form action={resendAction}><CsrfField /><Button type="submit" variant="secondary" size="sm" loading={sending}>Resend invite</Button></form>
          {self ? null : <form action={removeAction}><CsrfField /><Button type="submit" variant="secondary" size="sm" loading={removing}>Remove</Button></form>}
        </span>
      ) : null}
    </li>
  );
}
