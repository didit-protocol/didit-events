/**
 * U4 frames for the /_frames gallery: P-01, P-02a–n, P-03 and V-01 (design/04 AI Era Event) and G-01…G-03
 * (design/02 Guest and Emails), rendered with the real components and deterministic fixtures.
 *
 * Codes are unique per frame; the rendered `data-screen-label` is the design's own label, so state variants that
 * share a design code ("P-02 Signed out", "P-02 Pending approval", …) pair with the design captures in order.
 */
import type { CSSProperties, ReactNode } from "react";
import { EventCover, type CoverFormat, type CoverTheme } from "@didit-events/ui";
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { requestAction, subscribeAction, verifyAction } from "../../app/e/[slug]/actions";
import { startFromLinkAction } from "../../app/e/[slug]/v/[token]/actions";
import { calendarTab } from "../../app/events/data";
import { CalendarPage } from "./components/CalendarPage";
import { EventPage } from "./components/EventPage";
import { InviteScreen } from "./components/InviteScreen";
import { EventNotFound, GateMessage, InviteMessage, OutcomeMessage } from "./components/Messages";
import { RegistrationCard } from "./components/RegistrationCard";
import { SimpleEventPage } from "./components/SimpleEventPage";
import { AI_ERA, BCN_OPENING, CALENDAR, CARD_STATES, FIXED_NOW, MARIA } from "./fixtures";
import type { InviteState, OutcomeState, PublicEvent, RequestFormState, RequestInput } from "./types";

const CANVAS = "#E9E9EB";
const actions = { verify: verifyAction, subscribe: subscribeAction };
const related = AI_ERA.related.map((s) => CALENDAR.events.find((e) => e.slug === s)).filter((e): e is PublicEvent => Boolean(e));

/** The design frame box: label, width, 4px corners; `minH` pins the design height for full-height screens. */
function Shell({ label, w, minH, radius = 4, children }: { label: string; w: number; minH?: number; radius?: number; children: ReactNode }) {
  const style = { width: w, borderRadius: radius, overflow: "hidden", background: "#FEFEFE", ...(minH ? { "--page-min-h": `${minH}px` } : null) } as CSSProperties;
  return (
    <div data-screen-label={label} style={style}>
      {children}
    </div>
  );
}

const frame = (code: string, name: string, label: string, w: number, h: number, render: () => ReactNode): FrameDef => ({
  code,
  name,
  app: "events",
  viewport: { w, h },
  background: CANVAS,
  render: () => (
    <Shell label={label} w={w} minH={w === 390 && code.startsWith("G-") ? h : code === "G-01j" ? h : undefined}>
      {render()}
    </Shell>
  ),
});

/* ── G-01 form states (02 Guest `fields(mode)`) ─────────────────── */
const FILLED: RequestInput = { firstName: "Maria", lastName: "García", email: "maria.garcia@gmail.com", company: "Globex", role: "Head of Risk" };
const G01_FORMS: { code: string; name: string; initial?: RequestFormState; pending?: boolean }[] = [
  { code: "G-01a", name: "/ default" },
  {
    code: "G-01b",
    name: "/ validation errors",
    initial: { status: "invalid", values: { ...FILLED, lastName: "", email: "maria.garcia@gmail" }, errors: { lastName: "Enter your last name", email: "Enter a valid email address" } },
  },
  { code: "G-01c", name: "/ submitting", initial: { status: "idle", values: FILLED }, pending: true },
  { code: "G-01d", name: "/ submitted", initial: { status: "submitted", firstName: "Maria" } },
  { code: "G-01e", name: "/ already requested", initial: { status: "already", values: FILLED, email: FILLED.email } },
];

const INVITES: { code: string; name: string; state: Exclude<InviteState, "valid"> }[] = [
  { code: "G-02b", name: "/ link expired", state: "expired" },
  { code: "G-02c", name: "/ link revoked", state: "revoked" },
  { code: "G-02d", name: "/ already verified", state: "verified" },
  { code: "G-02e", name: "/ in review", state: "in_review" },
];

const OUTCOMES: { code: string; name: string; state: OutcomeState }[] = [
  { code: "G-03a", name: "/ approved", state: "approved" },
  { code: "G-03b", name: "/ in review", state: "in_review" },
  { code: "G-03c", name: "/ declined", state: "declined" },
  { code: "G-03d", name: "/ not finished", state: "not_finished" },
];

const COVERS: { code: string; format: CoverFormat; theme: CoverTheme; w: number; h: number; name: string }[] = [
  { code: "V-01a", format: "square", theme: "sky", w: 1080, h: 1080, name: "Cover art · square sky" },
  { code: "V-01b", format: "square", theme: "aqua", w: 1080, h: 1080, name: "Cover art · square aqua" },
  { code: "V-01c", format: "og", theme: "sky", w: 1200, h: 630, name: "Cover art · OG sky" },
  { code: "V-01d", format: "og", theme: "aqua", w: 1200, h: 630, name: "Cover art · OG aqua" },
  { code: "V-01e", format: "story", theme: "sky", w: 1080, h: 1920, name: "Cover art · story sky" },
];


export const publicFrames: FrameDef[] = [
  frame("P-01", "Event page desktop", "P-01 Event page desktop", 1440, 2760, () => (
    <EventPage
      event={AI_ERA}
      related={related}
      viewer={MARIA}
      card={{ kind: "request", viewer: MARIA }}
      now={new Date("2026-10-08T18:02:00+02:00")}
      actions={actions}
    />
  )),
  frame("P-01-mobile", "Event page mobile", "P-01 Event page mobile", 390, 2240, () => (
    <EventPage event={AI_ERA} related={related} viewer={null} card={{ kind: "signed_out" }} now={FIXED_NOW} actions={actions} />
  )),
  ...CARD_STATES.map<FrameDef>(({ code, name, state }) => ({
    code,
    name,
    app: "events",
    viewport: { w: 592, h: 340 },
    background: CANVAS,
    render: () => (
      <div data-screen-label={`P-02 ${name}`} style={{ width: 592 }}>
        <RegistrationCard event={AI_ERA} state={state} actions={actions} />
      </div>
    ),
  })),
  frame("P-03a", "Calendar · upcoming", "P-03 Calendar · upcoming", 1440, 1260, () => (
    <CalendarPage calendar={CALENDAR} tab="upcoming" events={calendarTab(CALENDAR.events, "upcoming", FIXED_NOW)} viewer={null} actions={actions} />
  )),
  frame("P-03b", "Calendar · past", "P-03 Calendar · past", 1440, 1120, () => (
    <CalendarPage calendar={CALENDAR} tab="past" events={calendarTab(CALENDAR.events, "past", FIXED_NOW)} viewer={null} actions={actions} />
  )),
  ...COVERS.map<FrameDef>((c) => ({
    code: c.code,
    name: c.name,
    app: "events",
    viewport: { w: c.w, h: c.h },
    background: CANVAS,
    render: () => (
      <div data-screen-label={`V-01 ${c.name}`} style={{ width: c.w }}>
        <EventCover format={c.format} theme={c.theme} panels={AI_ERA.panels.map((p) => p.title)} />
      </div>
    ),
  })),
  ...G01_FORMS.map((f) =>
    frame(f.code, f.name, `G-01 ${f.name}`, 390, 844, () => <SimpleEventPage event={BCN_OPENING} action={requestAction} initial={f.initial} pending={f.pending} />),
  ),
  frame("G-01f", "/ requests closed", "G-01 / requests closed", 390, 844, () => <GateMessage event={BCN_OPENING} gate="closed" />),
  frame("G-01g", "/ event full", "G-01 / event full", 390, 844, () => <GateMessage event={BCN_OPENING} gate="full" />),
  frame("G-01h", "/ event ended", "G-01 / event ended", 390, 844, () => <GateMessage event={BCN_OPENING} gate="ended" />),
  frame("G-01i", "/ event not found", "G-01 / event not found", 390, 844, () => <EventNotFound />),
  frame("G-01j", "Event page desktop", "G-01 Event page desktop", 1440, 900, () => <SimpleEventPage event={BCN_OPENING} action={requestAction} />),
  frame("G-02a", "/ default", "G-02 / default", 390, 844, () => <InviteScreen event={BCN_OPENING} firstName="Maria" token="demo" start={startFromLinkAction} />),
  ...INVITES.map((f) => frame(f.code, f.name, `G-02 ${f.name}`, 390, 844, () => <InviteMessage event={BCN_OPENING} state={f.state} />)),
  ...OUTCOMES.map((f) =>
    frame(f.code, f.name, `G-03 ${f.name}`, 390, 844, () => (
      <OutcomeMessage event={BCN_OPENING} state={f.state} attemptsLeft={1} verify={verifyAction} origin="https://events.didit.me" />
    )),
  ),
];

/** Every frame code this lane owns (the registry test iterates these). */
export const PUBLIC_FRAME_CODES = publicFrames.map((f) => f.code);
