import { requireEventAccess } from "../../../../../../../src/auth/access";
import { requireEvent } from "../../data";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OverviewView } from "../../../../../../../src/admin/overview/OverviewView";
import { getOverview } from "./data";

export const metadata: Metadata = { title: "Overview · Didit Events" };

// A-04 at /admin/events/[id], with the A-17 door panel while the event is live.
export default async function EventOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEventAccess((await params).id, "event.view");
  const { id: idOrSlug } = await params;
  const { slug: id } = await requireEvent(idOrSlug);
  const data = await getOverview(id);
  if (!data) notFound();
  return <OverviewView data={data} now={new Date()} doorPanel />;
}
