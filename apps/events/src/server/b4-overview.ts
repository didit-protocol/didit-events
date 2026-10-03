import type { OverviewData } from "../admin/overview/types";
import { adminStatus,type eventReadModel } from "./b4-views";
type Model = NonNullable<Awaited<ReturnType<typeof eventReadModel>>>;
export function overview(model: Model): OverviewData {
  const { event, views, checkins, kiosks, approvedCount } = model, active = checkins.filter(c => !c.undoneAt);
  // Test mode scans admitted nobody: they never count.
  const scans = model.scans.filter(s => !s.test);
  const name = (id: string | null) => views.find(v => v.registration.id === id)?.account;
  const displayName = (id: string | null) => { const a = name(id); return a ? [a.firstName, a.lastName].filter(Boolean).join(" ") || a.email : null; };
  const start = event.startsAt.getTime() - 900000, count = Math.min(1000, Math.ceil((event.endsAt.getTime() - start) / 900000));
  return { eventId: event.id, status: adminStatus(event), ...(event.status === "cancelled" ? { cancelReason: model.cancelReason } : {}), timeZone: event.timezone, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(),
    counts: { approved: approvedCount, pending: model.registrations.filter(r => r.admission === "pending").length, registrations: model.registrations.length, invited: model.activeInvites.length, linksSent: model.outbox.filter(o => o.kind === "email:M-03" && o.status === "sent").length, verified: views.filter(v => v.eligible && v.registration.admission === "approved").length, checkedIn: active.length, unknownFaces: scans.filter(s => s.result === "unknown").length },
    checkedInLast15: active.filter(c => c.checkedInAt.getTime() > Date.now() - 900000).length,
    unknownDoors: [...new Set(scans.filter(s => s.result === "unknown").map(s => kiosks.find(k => k.id === s.kioskId)?.name ?? "Entrance"))],
    buckets: Array.from({ length: count }, (_, i) => ({ start: new Date(start + i * 900000).toISOString(), count: active.filter(c => c.checkedInAt.getTime() >= start + i * 900000 && c.checkedInAt.getTime() < start + (i + 1) * 900000).length })),
    arrivals: active.slice(0, 50).map(c => ({ id: c.id, name: displayName(c.registrationId) ?? "", door: kiosks.find(k => k.id === c.kioskId)?.name ?? "Manual check-in", at: c.checkedInAt.toISOString() })),
    doors: kiosks.filter(k => !k.revokedAt).map(k => ({ id: k.id, name: k.name, online: !!k.lastSeenAt && Date.now() - k.lastSeenAt.getTime() < 60000, scanning: event.door.kiosk, mode: event.door.kiosk ? event.door.mode : "supervised", recent: scans.filter(s => s.kioskId === k.id).slice(0, 5).map(s => ({ id: s.id, result: s.result, at: s.createdAt.toISOString(), guest: displayName(s.registrationId) })) })) };
}
