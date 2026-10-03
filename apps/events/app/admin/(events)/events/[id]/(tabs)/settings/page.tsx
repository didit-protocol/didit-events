import { can } from "@didit-events/core/access/capabilities";
import { roleOn } from "@didit-events/core/access/principal";
import { eventAccess } from "../../../../../../../src/auth/access";
import { requireEvent } from "../../data";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LazyRequirementsModal } from "../../../../../../../src/admin/applicants/LazyRequirements";
import { RequirementsSection } from "../../../../../../../src/admin/applicants/RequirementsSection";
import { adminLinks } from "../../../../../../../src/admin/links";
import { SettingsView } from "../../../../../../../src/admin/settings/SettingsView";
import { getRequirements } from "../applicants/data";
import { getSettings } from "./data";

export const metadata: Metadata = { title: "Settings · Didit Events" };

type Params = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// A-11 Settings with the A-18 Spend and limits section, and the AP-27 verification requirements (?requirements=1).
export default async function EventSettingsPage({ params, searchParams }: Params) {
  const { viewer, event } = await eventAccess((await params).id, "event.edit");
  const role = roleOn(viewer, event.id);
  const hide = (["limits", "danger"] as const).filter((section) => !can(role, section === "limits" ? "event.limits" : "event.danger"));
  const [{ id: idOrSlug }, sp] = await Promise.all([params, searchParams]);
  const { slug: id } = await requireEvent(idOrSlug);
  const [settings, requirements] = await Promise.all([getSettings(id), getRequirements(id)]);
  if (!settings) notFound();
  return (
    <>
      <SettingsView settings={settings} hide={hide} requirements={requirements ? <RequirementsSection eventId={id} requirements={requirements} /> : undefined} />
      {requirements && sp.requirements === "1" ? <LazyRequirementsModal eventId={id} initial={requirements} closeHref={adminLinks.tab(id, "settings")} /> : null}
    </>
  );
}
