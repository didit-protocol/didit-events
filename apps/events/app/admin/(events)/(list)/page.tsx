import { requireGlobalAccess } from "../../../../src/auth/access";
import type { Metadata } from "next";
import { EventsList } from "../../../../src/admin/list/EventsList";
import { filterEvents, parseQuery, parseStatus, statusCounts } from "../../../../src/admin/list/filter";
import { listEvents } from "./data";

export const metadata: Metadata = { title: "Events · Didit Events" };

// A-02 at /admin. It sits in the (list) group so its loading.tsx does not also cover /admin/events/**.
export default async function EventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireGlobalAccess("admin.enter", "/admin");
  const sp = await searchParams;
  const q = parseQuery(sp.q);
  const status = parseStatus(sp.status);
  const { rows: all, canCreate } = await listEvents();
  return <EventsList events={filterEvents(all, { q, status })} counts={statusCounts(all)} q={q} status={status} canCreate={canCreate} />;
}
