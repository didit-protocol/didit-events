"use client";
import { CsrfField } from "../../auth/CsrfField";

import { useActionState, useEffect, useState } from "react";
import { Banner, EmailField, Select, SubmitButton } from "@didit-events/ui";
import { inviteStaffAction } from "../../../app/admin/team/actions";
import { handleSessionExpired } from "../system/session";
import { staffEmailPlaceholder } from "./domain";
import { ROLE_LABEL } from "./labels";
import { ROLE_SUMMARY } from "./roles";
import type { InviteState, StaffRole } from "./types";
import s from "./Team.module.css";

const IDLE: InviteState = { status: "idle" };

/** A-19 invite row: staff-domain email, role, "Send invite"; the result is announced below it. "sent" means the staff
 *  row and its invite email are both queued; "failed" keeps the draft and says nothing was saved. */
export function InviteForm({ roles, initialState = IDLE }: { roles: StaffRole[]; initialState?: InviteState }) {
  const [state, action] = useActionState(inviteStaffAction, initialState);
  useEffect(() => {
    handleSessionExpired(state);
  }, [state]);
  const invalid = state.status === "invalid" || state.status === "failed" ? state : undefined;
  const initialRole = invalid?.role || "staff";
  // React resets the form after each action, so the select falls back to its default; follow it.
  const [role, setRole] = useState<string>(initialRole);
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    setRole(initialRole);
  }
  const hint = Object.hasOwn(ROLE_SUMMARY, role) ? <span className={s.roleHint}>{ROLE_SUMMARY[role as StaffRole]}</span> : undefined;
  return (
    <form action={action} className={s.invite} noValidate><CsrfField />
      <div className={s.inviteRow}>
        <EmailField
          key={state.status === "sent" ? state.email : "draft"}
          name="email"
          label="Invite by email"
          placeholder={staffEmailPlaceholder()}
          defaultValue={invalid?.email}
          error={state.status === "invalid" ? state.errors.email : undefined}
          required
          className={s.inviteEmail}
        />
        <Select
          name="role"
          label="Role"
          defaultValue={initialRole}
          onChange={(e) => setRole(e.target.value)}
          hint={hint}
          error={state.status === "invalid" ? state.errors.role : undefined}
          options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          className={s.inviteRole}
        />
        <SubmitButton pendingLabel="Sending…" className={s.inviteSubmit}>
          Send invite
        </SubmitButton>
      </div>
      <div aria-live="polite" className={s.inviteStatus}>
        {state.status === "sent" ? (
          <Banner tone="success" className={s.inviteBanner}>
            Invite sent to {state.email}. They can sign in with Google now.
          </Banner>
        ) : state.status === "failed" ? (
          <Banner tone="danger" className={s.inviteBanner}>
            {state.message}
          </Banner>
        ) : null}
      </div>
    </form>
  );
}
