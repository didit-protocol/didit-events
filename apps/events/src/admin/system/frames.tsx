/** A-13 System states (design/01b Admin): 1440×760 frames with the events sidebar. */
import type { ReactNode } from "react";
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { ALBERTO, BCN_OPENING } from "../fixtures";
import { adminFrame } from "../frame";
import { AdminShell } from "../shell/AdminShell";
import { SystemBanners } from "./AdminChrome";
import { AdminErrorView } from "./AdminErrorView";
import { PlaceholderPage } from "./PlaceholderPage";
import { SessionExpiredModal } from "./SessionExpiredModal";
import { FRAME_REQUEST_ID, NOT_STAFF_EMAIL } from "./fixtures";
import { EventNotFound, NotStaff } from "./SystemPages";
import s from "./System.module.css";

const W = 1440;
const H = 760;

const page = (children: ReactNode, banner?: ReactNode) => (
  <AdminShell fill active="events" user={ALBERTO} banner={banner}>
    {children}
  </AdminShell>
);

export const systemFrames: FrameDef[] = [
  adminFrame("A-13a", "A-13 404 / event not found", W, H, () => page(<EventNotFound />)),
  adminFrame("A-13b", "A-13 403 / not a Didit account", W, H, () => page(<NotStaff email={NOT_STAFF_EMAIL} />)),
  adminFrame("A-13c", "A-13 500 / something broke", W, H, () => page(<AdminErrorView requestId={FRAME_REQUEST_ID} />)),
  adminFrame("A-13d", "A-13 Offline banner", W, H, () => page(<PlaceholderPage title={BCN_OPENING.name} />, <SystemBanners status={{ diditApi: "ok" }} offline />)),
  adminFrame("A-13e", "A-13 Didit API unavailable banner", W, H, () => page(<PlaceholderPage title={BCN_OPENING.name} />, <SystemBanners status={{ diditApi: "degraded" }} />)),
  adminFrame("A-13f", "A-13 Session expired modal", W, H, () => (
    <>
      {page(<PlaceholderPage title={BCN_OPENING.name} />)}
      <div className={s.frameScrim}>
        <SessionExpiredModal open inline />
      </div>
    </>
  )),
];
