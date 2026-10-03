import { cache } from "react";
import type { StaffPrincipal } from "@didit-events/core";
import { can } from "@didit-events/core/access/capabilities";
import { requireEventAccess } from "../../../../../../../src/auth/access";
import { personSummary } from "../../../../../../../src/server/b4-person";
import { adminModel, adminStatus } from "../../../../../../../src/server/b4-views";
import { filterScans, summarizeScans } from "../../../../../../../src/admin/log/helpers";
import type { LogFilters, LogPage, LogSummary, Scan } from "../../../../../../../src/admin/log/types";
const name = (first: string | null, last: string | null, email: string) => [first, last].filter(Boolean).join(" ") || email;
/** The row avatar follows the Guests table: the photo needs guests.photo (operators get initials + badge). */
const access = (actor: StaffPrincipal) => ({ photos: can(actor.scope?.role ?? actor.role, "guests.photo") });
/** Built once per render for the summary and the page (React cache; keyed by the event and whether photos show). */
const rowsOf = cache(async (eventId: string, showPhotos: boolean) => {
  const m = await adminModel(eventId); if (!m) return null;
  const now = new Date(), photos = { photos: showPhotos };
  const byRegistration = new Map(m.views.map(v => [v.registration.id, v]));
  const scans: Scan[] = m.scans.map(s => { const v = s.registrationId ? byRegistration.get(s.registrationId) : undefined, a = v?.account; return { id: s.id, at: s.createdAt.toISOString(), result: s.result, guestName: a ? name(a.firstName, a.lastName, a.email) : null, registrationId: v ? v.registration.id : null, ...(a ? { guestEmail: a.email } : {}), ...(v ? { person: { ...personSummary(m.event.id, v, now, photos), timeZone: m.event.timezone } } : {}), doorId: s.kioskId, similarity: s.candidates.length ? Math.max(...s.candidates.map(c => c.score)) : null, latencyMs: s.latencyMs, test: s.test }; });
  const missing = m.views.filter(v => v.registration.admission === "approved" && v.eligible && !v.checkedIn).map(v => ({ id: v.registration.id, name: name(v.account.firstName, v.account.lastName, v.account.email), email: v.account.email, phone: null, verifiedAt: v.verification?.decidedAt?.toISOString() ?? v.registration.updatedAt.toISOString() }));
  return { m, scans, missing };
});
const data = (eventId: string, actor: StaffPrincipal) => rowsOf(eventId, access(actor).photos);
export async function getLogSummary(eventId: string, filters: LogFilters): Promise<LogSummary | null> {
  const actor = await requireEventAccess(eventId, "checkin.view");
  const d = await data(eventId, actor); if (!d) return null;
  // The chips count exactly the rows the table lists (Test mode scans on their own "Test" chip, inside "All").
  return { status: adminStatus(d.m.event), timeZone: d.m.event.timezone, startsAt: d.m.event.startsAt.toISOString(), doors: d.m.kiosks.map(k => ({ id: k.id, name: k.name })), pairedKiosks: d.m.kiosks.filter(k => !k.revokedAt && k.lastSeenAt && Date.now() - k.lastSeenAt.getTime() < 600_000).map(k => k.name), ...summarizeScans(d.scans, filters), missing: d.missing.length };
}
/** The table rows for the filters; `scanId` (the `?scan=` panel) also returns that scan of this event, whatever the filters. */
export async function getLogPage(eventId: string, filters: LogFilters, scanId?: string): Promise<LogPage & { scan?: Scan | null }> {
  const actor = await requireEventAccess(eventId, "checkin.view");
  const d = await data(eventId, actor);
  const scan = scanId === undefined ? {} : { scan: d?.scans.find(s => s.id === scanId) ?? null };
  return filters.view === "missing" ? { view: "missing", guests: d?.missing ?? [], ...scan } : { view: "all", scans: filterScans(d?.scans ?? [], filters), ...scan };
}
