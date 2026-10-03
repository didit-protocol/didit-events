import { can } from "@didit-events/core/access/capabilities";
import { roleOn } from "@didit-events/core/access/principal";
import { eventAccess } from "../../../../../../../src/auth/access";
import { requireEvent } from "../../data";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminLinks } from "../../../../../../../src/admin/links";
import { logHref, parseLogFilters, toLogRow } from "../../../../../../../src/admin/log/helpers";
import { LogResults, LogToolbar } from "../../../../../../../src/admin/log/LogView";
import { getGuestDetail } from "../guests/data";
import { getLogPage, getLogSummary } from "./data";

export const metadata: Metadata = { title: "Check-in log · Didit Events" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[v.length - 1] : v) || undefined;

// A-09. Filters live in the URL (?view=missing, ?result=, ?door=, ?people=0), so the server renders every state.
// A row opens the Guests drawer (?guest=<registrationId>) or, without a registration, the scan panel (?scan=<scanId>).
// Both are hosted by the table on the client: opening and closing only move the URL (no render of this page). A deep
// link or a refresh still sends that scan, and streams that guest (same loader and capability as the Guests tab).
export default async function CheckInLogPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { viewer, event } = await eventAccess((await params).id, "checkin.view");
  const [{ id: idOrSlug }, sp] = await Promise.all([params, searchParams]);
  const { slug: id } = await requireEvent(idOrSlug);
  const filters = parseLogFilters(sp);
  const guest = one(sp.guest), scanId = guest ? undefined : one(sp.scan);
  const detail = guest ? getGuestDetail(id, guest) : null;
  // Not awaited here: it streams to the drawer host. A failure is the host's to handle (it asks the detail route).
  detail?.catch(() => {});
  const [summary, page] = await Promise.all([getLogSummary(id, filters), getLogPage(id, filters, scanId)]);
  if (!summary) notFound();
  const closeHref = logHref(id, filters);
  const addHref = can(roleOn(viewer, event.id), "guests.invite") ? `${adminLinks.tab(id, "guests")}?add=1` : null;
  return (
    <>
      <LogToolbar eventId={id} summary={summary} filters={filters} />
      <LogResults
        eventId={id}
        summary={summary}
        filters={filters}
        page={page}
        drawers={{ eventId: id, closeHref, addHref, scan: page.scan ? toLogRow(page.scan, summary.doors, summary.timeZone, id) : null, guest: detail && guest ? { id: guest, detail } : undefined }}
      />
    </>
  );
}
