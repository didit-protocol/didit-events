/**
 * Guests frames: A-05 list (design/01 Admin, 1440×1100 + 1024 and 390), A-06 drawer (01b, 480×1180), A-07 add
 * guests (01b, 760×820 scrim box), and the undrawn A-14 manual check-in, A-15 undo check-in, A-16 email mismatch
 * (design-prompt §3), drawn as drawer frames like A-06.
 */
import type { ReactNode } from "react";
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { BCN_OPENING } from "../fixtures";
import { EventTabFrame } from "../event/EventTabFrame";
import { adminFrame } from "../frame";
import { adminLinks } from "../links";
import { AddGuests, type AddGuestsProps } from "./AddGuests";
import { GuestDialogFrame, GuestDrawer, UndoToastFrame } from "./GuestDrawer";
import { BCN_GUESTS, DESIGN_GUESTS, EXISTING_EMAILS, mariaDetail, PASTE_VALID, PASTE_WITH_ERRORS, type DrawerFixture } from "./fixtures";
import { GuestsView, type GuestsViewProps } from "./GuestsView";
import { parseGuestPaste } from "./paste";
import { countGuests, parseGuestQuery } from "./query";
import type { GuestCounts } from "./types";
import d from "./Drawer.module.css";
import a from "./AddGuests.module.css";

const ID = BCN_OPENING.id;
const COUNTS = countGuests(BCN_GUESTS);
const ZERO = Object.fromEntries(Object.keys(COUNTS).map((k) => [k, 0])) as GuestCounts;
const CLOSE = adminLinks.tab(ID, "guests");

function List(props: Omit<GuestsViewProps, "eventId">) {
  return (
    <EventTabFrame event={BCN_OPENING} tab="guests" mobileBack={{ href: adminLinks.event(ID), label: BCN_OPENING.name }}>
      <GuestsView eventId={ID} {...props} />
    </EventTabFrame>
  );
}

const POPULATED = { rows: DESIGN_GUESTS, total: 124, page: 1, pageSize: 15 };
const Q = parseGuestQuery({});

function Drawer({ state, children }: { state: DrawerFixture | null; children?: ReactNode }) {
  return (
    <div className={d.frame}>
      <GuestDrawer eventId={ID} detail={state ? mariaDetail(state) : null} closeHref={CLOSE} inline />
      {children}
    </div>
  );
}

function Dialog({ kind }: { kind: "checkin" | "undo" }) {
  return <GuestDialogFrame name="María García" dialog={kind} />;
}

function Add({ initial }: { initial: AddGuestsProps["initial"] }) {
  return (
    <div className={a.frame}>
      <AddGuests eventId={ID} closeHref={CLOSE} existingEmails={EXISTING_EMAILS} initial={initial} inline />
    </div>
  );
}

const withErrors = parseGuestPaste(PASTE_WITH_ERRORS, EXISTING_EMAILS);
const SCRIM = { background: "rgba(26,26,26,.24)" };
const drawer = (code: string, label: string, render: () => ReactNode) => adminFrame(code, label, 480, 1180, render);

export const guestsFrames: FrameDef[] = [
  adminFrame("A-05a", "A-05 Guests / populated (row selected, row sending, bounced row, row menu)", 1440, 1100, () => (
    <List query={Q} counts={COUNTS} page={POPULATED} frame={{ selected: ["amara-okafor", "jordi-puig"], hover: "oliver-bennett", menuFor: "amara-okafor" }} />
  )),
  adminFrame("A-05b", "A-05 Guests / loading", 1440, 1100, () => <List query={Q} counts={COUNTS} page={null} />),
  adminFrame("A-05c", "A-05 Guests / empty", 1440, 1100, () => <List query={Q} counts={ZERO} page={{ rows: [], total: 0, page: 1, pageSize: 15 }} />),
  adminFrame("A-05d", "A-05 Guests / filtered empty", 1440, 1100, () => (
    <List query={parseGuestQuery({ q: "okafor", status: "in-review" })} counts={COUNTS} page={{ rows: [], total: 0, page: 1, pageSize: 15 }} />
  )),
  adminFrame("A-05-1024", "A-05 Guests 1024", 1024, 1100, () => <List query={Q} counts={COUNTS} page={POPULATED} />),
  adminFrame("A-05-390", "A-05 Guests 390", 390, 1100, () => <List query={Q} counts={COUNTS} page={POPULATED} />),

  drawer("A-06a", "A-06 Drawer / loading", () => <Drawer state={null} />),
  drawer("A-06b", "A-06 Drawer / not started", () => <Drawer state="not-started" />),
  drawer("A-06c", "A-06 Drawer / in progress", () => <Drawer state="in-progress" />),
  drawer("A-06d", "A-06 Drawer / in review", () => <Drawer state="in-review" />),
  drawer("A-06e", "A-06 Drawer / declined", () => <Drawer state="declined" />),
  drawer("A-06f", "A-06 Drawer / verified", () => <Drawer state="verified" />),
  drawer("A-06g", "A-06 Drawer / checked in", () => <Drawer state="checked-in" />),

  adminFrame("A-07a", "A-07 Add guests / one guest · empty", 760, 820, () => <Add initial={{ step: "one" }} />, SCRIM),
  adminFrame("A-07b", "A-07 Add guests / paste · empty", 760, 820, () => <Add initial={{ step: "paste" }} />, SCRIM),
  adminFrame("A-07c", "A-07 Add guests / valid preview", 760, 820, () => <Add initial={{ step: "preview", text: PASTE_VALID }} />, SCRIM),
  adminFrame("A-07d", "A-07 Add guests / preview with errors", 760, 820, () => <Add initial={{ step: "preview", text: PASTE_WITH_ERRORS }} />, SCRIM),
  adminFrame("A-07e", "A-07 Add guests / adding", 760, 820, () => <Add initial={{ step: "adding", progress: { done: 14, total: 23 } }} />, SCRIM),
  adminFrame("A-07f", "A-07 Add guests / done", 760, 820, () => <Add initial={{ step: "done", result: { added: 23, skipped: withErrors.rows.filter((r) => r.status !== "ready") } }} />, SCRIM),

  drawer("A-14a", "A-14 Manual check-in / confirm", () => (
    <Drawer state="verified">
      <Dialog kind="checkin" />
    </Drawer>
  )),
  drawer("A-14b", "A-14 Manual check-in / done with undo toast", () => (
    <Drawer state="manual-checked-in">
      <UndoToastFrame message="María García checked in." />
    </Drawer>
  )),
  drawer("A-15a", "A-15 Undo check-in / confirm", () => (
    <Drawer state="checked-in">
      <Dialog kind="undo" />
    </Drawer>
  )),
  drawer("A-15b", "A-15 Undo check-in / audit line", () => <Drawer state="undone" />),
  drawer("A-16a", "A-16 Email mismatch review", () => <Drawer state="email-mismatch" />),
];
