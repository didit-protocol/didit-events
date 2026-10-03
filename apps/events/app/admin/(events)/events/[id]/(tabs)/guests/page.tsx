import { can } from "@didit-events/core/access/capabilities";
import { roleOn } from "@didit-events/core/access/principal";
import { eventAccess } from "../../../../../../../src/auth/access";
import { requireEvent } from "../../data";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuestsView } from "../../../../../../../src/admin/guests/GuestsView";
import { LazyAddGuests } from "../../../../../../../src/admin/guests/LazyOverlays";
import { guestsHref, listState, parseGuestQuery } from "../../../../../../../src/admin/guests/query";
import { existingEmails, getGuestDetail, listGuests } from "./data";

export const metadata: Metadata = { title: "Guests · Didit Events" };

type Params = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// A-05 list; ?guest= opens the A-06 drawer (A-14 / A-15 / revoke via ?checkin=1 / ?undo=1 / ?revoke=1); ?add= opens A-07.
// The drawer is a client host inside the list: opening and closing only move the URL (no render of this page). A deep
// link or a refresh still streams that guest from here (`seed`), so the drawer does not ask twice.
export default async function GuestsPage({ params, searchParams }: Params) {
  const { viewer, event } = await eventAccess((await params).id, "guests.view");
  const manage = can(roleOn(viewer, event.id), "guests.invite");
  const [{ id: idOrSlug }, sp] = await Promise.all([params, searchParams]);
  const { slug: id } = await requireEvent(idOrSlug);
  const query = parseGuestQuery(sp);
  const detail = query.guest ? getGuestDetail(id, query.guest) : null;
  // Not awaited here: it streams to the drawer host. A failure is the host's to handle (it asks the detail route).
  detail?.catch(() => {});
  // The list and the add-guests modal's data are independent: fetched together.
  const [list, emails] = await Promise.all([listGuests(id, query), query.add && manage ? existingEmails(id) : null]);
  if (!list) notFound();
  const closeHref = guestsHref(id, listState(query));
  return (
    <>
      <GuestsView eventId={id} query={query} counts={list.counts} page={list.page} manage={manage} drawer={{ closeHref, seed: detail && query.guest ? { id: query.guest, detail } : undefined }} />
      {query.add && emails ? <LazyAddGuests key={query.add} eventId={id} closeHref={closeHref} existingEmails={emails} initial={{ step: query.add }} /> : null}
    </>
  );
}
