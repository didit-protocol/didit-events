/**
 * Applicant review frames (lane U3): AP-01…AP-27 (design/05, 1440×960 with the admin sidebar) and S-00 Status model
 * (1800 wide, content height). Overlays (drawers, modals, toasts) render over the whole frame, sidebar included, as
 * drawn; the live app opens the same components through the URL or the review hook.
 */
import type { ReactNode } from "react";
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { EventHeader } from "../event/EventHeader";
import { ALBERTO } from "../fixtures";
import { adminFrame, CANVAS } from "../frame";
import { AdminShell } from "../shell/AdminShell";
import shell from "../shell/AdminShell.module.css";
import type { EventHeaderInfo } from "../types";
import { ApplicantDrawer } from "./ApplicantDrawer";
import type { ApplicantsFrameState } from "./ApplicantsReview";
import { ApplicantsView } from "./ApplicantsView";
import { ApplicantsHeaderActions, ApplicantsMeta } from "./HeaderExtras";
import { FrameScrim } from "./Dialogs";
import { BulkApproveFrame, CapacityFrame, RejectFrame, ToastFrame } from "./FrameOverlays";
import {
  AI_ERA,
  AI_ERA_APPLICANTS,
  APPROVED_ROWS,
  CANCELLED_ROWS,
  DEFAULT_REQUIREMENTS,
  DESIGN_APPLICANTS,
  DESIGN_COUNTS,
  DRAWER_DUPLICATE,
  DRAWER_MEETS_ALL,
  DRAWER_NEW,
  DRAWER_RETURNING,
  DRAWER_V2,
  INVITE_EMAILS,
  INVITE_MESSAGE,
  REJECTED_ROWS,
  SHARE_LINKS,
  WAITLIST_ROWS,
} from "./fixtures";
import { InviteModal, type InviteModalProps } from "./InviteModal";
import { applicantsHref, parseApplicantQuery } from "./query";
import { RequirementsModal } from "./RequirementsModal";
import { StatusModel } from "./StatusModel";
import type { ApplicantCounts, ApplicantDetail, ApplicantQuery, ApplicantRow, ApplicantsEvent } from "./types";

const ID = AI_ERA.id;
const CLOSE = applicantsHref(ID, {});
const P = parseApplicantQuery({});
const [INGRID, DIEGO, NADIA, TOM, , SAMUEL, ISABEL, KWAME] = DESIGN_APPLICANTS;
const EXISTING = DESIGN_APPLICANTS.map((r) => r.email);

interface ListProps {
  query?: ApplicantQuery;
  rows?: ApplicantRow[] | null;
  counts?: ApplicantCounts;
  event?: Partial<ApplicantsEvent>;
  header?: Partial<EventHeaderInfo>;
  frame?: ApplicantsFrameState;
  overlay?: ReactNode;
}

/** Shell + AP header (meta, Share request link, Invite guests) + the tab body, then any overlay over the whole frame. */
function Applicants({ query = P, rows = DESIGN_APPLICANTS, counts = DESIGN_COUNTS, event, header, frame, overlay }: ListProps) {
  const ev: ApplicantsEvent = { ...AI_ERA_APPLICANTS, ...event };
  const head: EventHeaderInfo = { ...AI_ERA, registration: ev.registration, ...header };
  return (
    <>
      <AdminShell fill active="events" user={ALBERTO}>
        <div className={shell.pageTight} style={{ gap: 18 }}>
          <EventHeader event={head} tab="applicants" meta={<ApplicantsMeta event={head} />} actions={<ApplicantsHeaderActions eventId={ID} />} />
          <ApplicantsView eventId={ID} query={query} counts={counts} rows={rows} event={ev} frame={frame} inline />
        </div>
      </AdminShell>
      {overlay}
    </>
  );
}

const ap = (code: string, label: string, render: () => ReactNode) => adminFrame(code, `${code} ${label}`, 1440, 960, render);

function drawer(detail: ApplicantDetail, row: ApplicantRow) {
  return <ApplicantDrawer inline eventId={ID} detail={detail} row={row} event={AI_ERA_APPLICANTS} index={3} total={7} prevHref={applicantsHref(ID, { applicant: NADIA!.id })} nextHref={applicantsHref(ID, { applicant: TOM!.id })} closeHref={CLOSE} />;
}

const MARIA: ApplicantRow = { id: "maria-garcia", name: "María García", email: "maria.garcia@gmail.com", signIn: "google", company: "Globex", role: "Head of Risk", why: "Building fraud tooling for mobility.", signals: [{ label: "Verified before", tone: "ok" }], verified: true, requested: "Today", tab: "pending" };

const toast = (tone: "progress" | "info", message: string, action?: string) => <ToastFrame tone={tone} message={message} action={action} />;

function Invite(props: Partial<InviteModalProps>) {
  return (
    <FrameScrim>
      <InviteModal inline eventId={ID} tab="email" closeHref={CLOSE} existingEmails={EXISTING} links={SHARE_LINKS} {...props} />
    </FrameScrim>
  );
}

const SELECTED = [INGRID!.id, NADIA!.id, SAMUEL!.id];

export const applicantFrames: FrameDef[] = [
  ap("AP-01", "Pending · populated (hover, one approving)", () => <Applicants frame={{ hover: INGRID!.id, busy: DIEGO!.id }} />),
  ap("AP-02", "Pending · 3 selected (bulk bar)", () => <Applicants frame={{ selected: SELECTED }} />),
  ap("AP-03", "Applicant drawer · new account", () => <Applicants overlay={drawer(DRAWER_NEW, DIEGO!)} />),
  ap("AP-04", "Applicant drawer · returning verified guest", () => <Applicants overlay={drawer(DRAWER_RETURNING, TOM!)} />),
  ap("AP-05", "Applicant drawer · possible duplicate", () => <Applicants overlay={drawer(DRAWER_DUPLICATE, ISABEL!)} />),
  ap("AP-06", "Approve · over capacity", () => (
    <Applicants
      event={{ approved: 120 }}
      header={{ registration: "open" }}
      overlay={<CapacityFrame names={[INGRID!.name]} approved={120} capacity={120} releaseOn={AI_ERA_APPLICANTS.releaseOn} />}
    />
  )),
  ap("AP-07", "Bulk approve · confirm", () => (
    <Applicants
      frame={{ selected: SELECTED }}
      overlay={<BulkApproveFrame rows={SELECTED.map((id) => ({ verified: id === INGRID!.id }))} approved={84} capacity={120} />}
    />
  )),
  ap("AP-08", "Bulk approving · in progress", () => <Applicants frame={{ busy: INGRID!.id }} overlay={toast("progress", "Approving 3 of 3… creating Didit links")} />),
  ap("AP-09", "Approve failed · row error", () => <Applicants frame={{ errors: [DIEGO!.id] }} />),
  ap("AP-10", "Reject · reason", () => (
    <Applicants
      overlay={<RejectFrame names={[KWAME!.name]} initial={{ reason: "Not a fit for this audience", email: true, block: false }} />}
    />
  )),
  ap("AP-11", "Rejected · undo toast", () => <Applicants rows={DESIGN_APPLICANTS.slice(0, 7)} counts={{ ...DESIGN_COUNTS, pending: 6, rejected: 10 }} overlay={toast("info", "Rejected Kwame Mensah · email in 30s", "Undo")} />),
  ap("AP-12", "Waitlist", () => <Applicants query={{ ...P, tab: "waitlist" }} rows={WAITLIST_ROWS} />),
  ap("AP-13", "Approved · verification status", () => <Applicants query={{ ...P, tab: "approved" }} rows={APPROVED_ROWS} />),
  ap("AP-14", "Rejected · with reasons", () => <Applicants query={{ ...P, tab: "rejected" }} rows={REJECTED_ROWS} />),
  ap("AP-15", "Cancelled by guest · with reasons", () => <Applicants query={{ ...P, tab: "cancelled" }} rows={CANCELLED_ROWS} />),
  ap("AP-16", "Invite directly · empty", () => <Applicants overlay={<Invite />} />),
  ap("AP-17", "Invite · checks invalid and existing", () => <Applicants overlay={<Invite initial={{ emails: INVITE_EMAILS, message: INVITE_MESSAGE }} />} />),
  ap("AP-18", "Invite · sending", () => <Applicants overlay={<Invite initial={{ step: { kind: "sending", done: 2, total: 4 } }} />} />),
  ap("AP-19", "Invite · sent", () => <Applicants overlay={<Invite initial={{ step: { kind: "sent", summary: { invited: 3, approvedExisting: 1, waitlisted: 0, skippedInvalid: 1 } } }} />} />),
  ap("AP-20", "Invite · share a link", () => <Applicants overlay={<Invite tab="link" initial={{ copied: true }} />} />),
  ap("AP-21", "Pending · empty", () => <Applicants rows={[]} counts={{ ...DESIGN_COUNTS, pending: 0 }} />),
  ap("AP-22", "Pending · search no results", () => <Applicants query={{ ...P, q: "glovo" }} rows={[]} />),
  ap("AP-23", "Loading", () => <Applicants rows={null} />),
  ap("AP-24", "Event full · auto-waitlist", () => <Applicants event={{ approved: 120, registration: "full" }} />),
  ap("AP-25", "Registration closed", () => <Applicants rows={DESIGN_APPLICANTS.slice(0, 2)} counts={{ ...DESIGN_COUNTS, pending: 2 }} event={{ registration: "closed" }} />),
  ap("AP-26", "Applicant drawer · meets all requirements", () => <Applicants overlay={drawer(DRAWER_MEETS_ALL, MARIA)} />),
  ap("AP-28", "Applicant drawer · full profile, answers and history (model v2)", () => <Applicants overlay={drawer(DRAWER_V2, MARIA)} />),
  ap("AP-27", "Event settings · verification requirements", () => (
    <Applicants
      overlay={
        <FrameScrim>
          <RequirementsModal inline eventId={ID} initial={DEFAULT_REQUIREMENTS} closeHref={CLOSE} />
        </FrameScrim>
      }
    />
  )),
  {
    code: "S-00",
    name: "Status model",
    app: "events",
    // The design frame is 1800 wide with a content height; h is the expected rendered height (pixel gate crops by element).
    viewport: { w: 1800, h: 2000 },
    background: CANVAS,
    render: () => (
      <div data-screen-label="S-00 Status model" style={{ width: 1800, position: "relative", background: "#FEFEFE", borderRadius: 4 }}>
        <StatusModel />
      </div>
    ),
  },
];

export const APPLICANT_FRAME_CODES = applicantFrames.map((f) => f.code);
