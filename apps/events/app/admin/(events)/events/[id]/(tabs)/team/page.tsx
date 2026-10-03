import type { Metadata } from "next";
import { can } from "@didit-events/core/access/capabilities";
import { roleOn } from "@didit-events/core/access/principal";
import { eventTeam } from "@didit-events/core/access/team";
import { eventAccess } from "../../../../../../../src/auth/access";
import { EventTeamView } from "../../../../../../../src/admin/event-team/EventTeamView";
import { addMemberAction, removeMemberAction, resendMemberAction } from "./actions";

export const metadata: Metadata = { title: "Team · Didit Events" };

/** Event Team tab: hosts and door operators of this event. Staff and hosts manage it; everyone on it can see it. */
export default async function EventTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, event, viewer } = await eventAccess(id, "team.view");
  const members = await eventTeam.list(actor, event.id);
  const manage = can(roleOn(viewer, event.id), "team.manage");
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: event.timezone, day: "numeric", month: "short" });
  const rows = members.map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role, invitedBy: m.invitedBy, added: fmt.format(m.createdAt) }));
  return (
    <EventTeamView
      eventName={event.name}
      members={rows}
      manage={manage}
      self={viewer.email}
      add={addMemberAction.bind(null, event.slug)}
      remove={removeMemberAction.bind(null, event.slug)}
      resend={resendMemberAction.bind(null, event.slug)}
    />
  );
}
