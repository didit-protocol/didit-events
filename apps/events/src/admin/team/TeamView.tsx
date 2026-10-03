import { CsrfField } from "../../auth/CsrfField";
import { Avatar, ClientButtonLink, Skeleton, StatusPill, SubmitButton } from "@didit-events/ui";
import { restoreStaffAction } from "../../../app/admin/team/actions";
import { PageHeading } from "../shell/PageHeading";
import shell from "../shell/AdminShell.module.css";
import type { StaffUser } from "../types";
import { DisableAccess } from "./DisableAccess";
import { InviteForm } from "./InviteForm";
import { ResendInvite } from "./ResendInvite";
import { RoleGuide } from "./RoleGuide";
import { ROLE_SUMMARY } from "./roles";
import { staffAccountPhrase } from "./domain";
import { assignableRoles, canDisable, canResendInvite, canRestore, formatLastActive, ROLE_LABEL } from "./policy";
import type { InviteState, TeamMember } from "./types";
import s from "./Team.module.css";

export const TEAM_COPY = {
  readOnly: `Everyone with ${staffAccountPhrase()} who has signed in. Read-only for now.`,
  manage: `Everyone with ${staffAccountPhrase()} who can sign in. Owners and admins invite teammates and manage access.`,
  emptyTitle: "Only you so far.",
  emptyHelp: "Teammates appear here after their first sign-in.",
  emptyHelpManage: "Invite a teammate above. They appear here once invited.",
} as const;

export interface TeamViewProps {
  viewer: StaffUser;
  /** Null while loading (A-12b). */
  members: TeamMember[] | null;
  now: Date;
  /** A-19 controls (owners and admins). Off = the read-only A-12 list. */
  manage: boolean;
  /** Frame gallery: the invite form's result (A-19a/b). */
  inviteState?: InviteState;
  /** Personal access tokens page: shown as a heading action to the people who can manage tokens. */
  tokensHref?: string;
}

/** A-12 Team (read-only) and A-19 Team management (invite, roles, disable / restore, last active). */
export function TeamView({ viewer, members, now, manage, inviteState, tokensHref }: TeamViewProps) {
  const cols = manage ? s.colsManage : s.colsRead;
  const empty = members !== null && members.every((m) => m.email === viewer.email);
  return (
    <div className={`${shell.page} ${s.page}`}>
      <PageHeading
        title="Team"
        description={manage ? TEAM_COPY.manage : TEAM_COPY.readOnly}
        actions={
          tokensHref ? (
            <ClientButtonLink variant="secondary" size="sm" href={tokensHref}>
              Access tokens
            </ClientButtonLink>
          ) : undefined
        }
      />
      {manage ? (
        <>
          <InviteForm roles={assignableRoles(viewer)} initialState={inviteState} />
          <RoleGuide />
        </>
      ) : null}
      <div role="table" aria-label="Team" aria-busy={members === null || undefined} className={s.table}>
        <div role="rowgroup">
          <div role="row" className={`${s.row} ${s.head} ${cols}`}>
            <span role="columnheader">NAME</span>
            <span role="columnheader">EMAIL</span>
            {manage ? <span role="columnheader">ROLE</span> : null}
            <span role="columnheader">LAST ACTIVE</span>
            {manage ? (
              <span role="columnheader" className={s.srOnly}>
                Actions
              </span>
            ) : null}
          </div>
        </div>
        <div role="rowgroup">
          {members === null
            ? Array.from({ length: 5 }, (_, i) => (
                <div key={i} role="row" aria-hidden="true" className={`${s.row} ${cols}`}>
                  <span className={s.person}>
                    <Skeleton width={28} height={28} className={s.skAvatar} />
                    <Skeleton width="40%" height={10} />
                  </span>
                  <Skeleton width="60%" height={10} />
                  {manage ? <Skeleton width="40%" height={10} /> : null}
                  <Skeleton width="40%" height={10} />
                  {manage ? <span /> : null}
                </div>
              ))
            : members.map((m) => (
                <div key={m.email} role="row" className={`${s.row} ${cols}`} data-disabled={m.disabledAt ? "" : undefined}>
                  <span role="cell" className={s.person}>
                    {/* One letter, as the header, People and the profile draw it. */}
                    <Avatar name={m.name} email={m.email} size={28} className={s.avatar} />
                    <span className={s.who}>
                      <span className={s.name}>{m.name}</span>
                      {/* Narrow layout only (CSS): the hidden EMAIL column, so two "alberto" rows can be told apart. */}
                      <span className={s.mail}>{m.email}</span>
                      {/* Narrow layout only (CSS): the hidden ROLE and LAST ACTIVE columns, under the name. */}
                      {manage ? (
                        <span className={s.sub}>
                          {m.disabledAt ? "Disabled" : ROLE_LABEL[m.role]} · {formatLastActive(m.lastActiveAt, now)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span role="cell" className={s.secondary}>
                    {m.email}
                  </span>
                  {manage ? (
                    <span role="cell" className={s.secondary} title={m.disabledAt ? undefined : ROLE_SUMMARY[m.role]}>
                      {m.disabledAt ? <StatusPill status="ended">Disabled</StatusPill> : ROLE_LABEL[m.role]}
                    </span>
                  ) : null}
                  <span role="cell" className={s.secondary}>
                    {formatLastActive(m.lastActiveAt, now)}
                  </span>
                  {manage ? (
                    <span role="cell" className={s.actions}>
                      {canResendInvite(viewer, m) ? <ResendInvite email={m.email} name={m.name} /> : null}
                      {canDisable(viewer, m) ? <DisableAccess email={m.email} name={m.name} /> : null}
                      {canRestore(viewer, m) ? (
                        <form action={restoreStaffAction}><CsrfField />
                          <input type="hidden" name="email" value={m.email} />
                          <SubmitButton variant="secondary" size="sm" pendingLabel="Restoring…" aria-label={`Restore access for ${m.name}`}>
                            Restore
                          </SubmitButton>
                        </form>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              ))}
        </div>
        {empty ? (
          <div role="row">
            <div role="cell" className={s.empty}>
              <span className={s.emptyTitle}>{TEAM_COPY.emptyTitle}</span>
              <span className={s.emptyHelp}>{manage ? TEAM_COPY.emptyHelpManage : TEAM_COPY.emptyHelp}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
