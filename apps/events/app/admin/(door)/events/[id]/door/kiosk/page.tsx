import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { QrCode } from "@didit-events/ui/qr";
import { doorService } from "@didit-events/core/door/service";
import { adminLinks } from "../../../../../../../src/admin/links";
import { eventAccess } from "../../../../../../../src/auth/access";
import { csrfToken, sessionSecret } from "../../../../../../../src/auth/browser";
import { LazyDoorApp } from "../../../../../../../src/door/LazyDoorApp";
import { BUILD_ID, doorPageSession } from "../../../../../../../src/door/http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Door · Didit Events" };

/** The request's instant (the route is force-dynamic): the kiosk clock hydrates with the minute the server printed. */
const requestInstant = () => Date.now();

/**
 * /admin/events/{id}/door/kiosk: the full-screen kiosk, with no admin chrome, for a device in door mode (the door
 * cookie of this event). "Start door mode", "Resume door mode" and the kiosk's own reloads land here. Without a live
 * door session there is nothing to run: the device goes to the Door tab (through the sign-in when nobody is signed
 * in here), which says why the door ended and offers a new start.
 */
export default async function DoorKioskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const here = await doorPageSession(id);
  if (!here.door) {
    const tab = adminLinks.tab(id, "door");
    await eventAccess(id, "door.operate", tab);
    redirect(tab);
  }
  const context = await doorService.context(here.door);
  return <LazyDoorApp initial={{ ...context, build: BUILD_ID }} build={BUILD_ID} renderedAt={requestInstant()} csrf={csrfToken(here.cookie, sessionSecret())} offlineQr={<QrCode value={context.event.logUrl} size={168} label="QR code: the event's check-in log in the admin" />} />;
}
