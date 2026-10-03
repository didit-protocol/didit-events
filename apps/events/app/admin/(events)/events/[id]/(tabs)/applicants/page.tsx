import { requireEventAccess } from "../../../../../../../src/auth/access";
import { requireEvent } from "../../data";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApplicantsView } from "../../../../../../../src/admin/applicants/ApplicantsView";
import { LazyInviteModal } from "../../../../../../../src/admin/applicants/LazyOverlays";
import { applicantsHref, listState, parseApplicantQuery } from "../../../../../../../src/admin/applicants/query";
import { existingEmails, getApplicantDetail, getShareLinks, listApplicants } from "./data";

export const metadata: Metadata = { title: "Requests · Didit Events" };

type Params = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// AP-01…AP-25 list (?tab= segments, ?q= search, ?signin= / ?signal= filters); ?applicant= opens the drawer
// (AP-03…AP-05, AP-26); ?invite=email|link opens the invite modal (AP-16…AP-20).
// The drawer is a client host inside the list: opening, ‹ › and closing only move the URL (no render of this page).
// A deep link or a refresh still streams that applicant from here (`seed`), so the drawer does not ask twice.
export default async function ApplicantsPage({ params, searchParams }: Params) {
  await requireEventAccess((await params).id, "guests.view");
  const [{ id: idOrSlug }, sp] = await Promise.all([params, searchParams]);
  const { slug: id } = await requireEvent(idOrSlug);
  const query = parseApplicantQuery(sp);
  const found = query.applicant ? getApplicantDetail(id, query.applicant, query) : null;
  // Not awaited here: it streams to the drawer host. A failure is the host's to handle (it asks the detail route).
  found?.catch(() => {});
  // The list and the invite modal's data are independent: one round of queries, not three in a row.
  const [list, links, emails] = await Promise.all([listApplicants(id, query), query.invite ? getShareLinks(id) : null, query.invite ? existingEmails(id) : null]);
  if (!list) notFound();
  const closeHref = applicantsHref(id, listState(query));
  return (
    <>
      <span data-gap="18" hidden />
      <ApplicantsView eventId={id} query={query} counts={list.counts} rows={list.rows} event={list.event} drawer={{ seed: found && query.applicant ? { id: query.applicant, found } : undefined }} />
      {query.invite && links && emails ? <LazyInviteModal key={query.invite} eventId={id} tab={query.invite} closeHref={closeHref} existingEmails={emails} links={links} /> : null}
    </>
  );
}
