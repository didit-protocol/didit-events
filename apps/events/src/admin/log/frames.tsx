/** A-09 Check-in log (design/01b Admin): five 1440×960 frames with the event header on the "Check-in log" tab. */
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { BCN_OPENING, withStatus } from "../fixtures";
import { EventTabFrame } from "../event/EventTabFrame";
import { adminFrame } from "../frame";
import type { EventHeaderInfo } from "../types";
import { LOG_SCANS, LOG_SUMMARY_BEFORE, LOG_SUMMARY_LIVE, MISSING_GUESTS, fixtureSummary } from "./fixtures";
import { DEFAULT_FILTERS, filterScans } from "./helpers";
import { LogResults, LogToolbar } from "./LogView";
import type { LogFilters, LogPage, LogSummary } from "./types";

const W = 1440;
const H = 960;
const ID = BCN_OPENING.id;

function LogFrame({ event = BCN_OPENING, summary, filters, page }: { event?: EventHeaderInfo; summary: LogSummary; filters: LogFilters; page: LogPage }) {
  return (
    <EventTabFrame event={event} tab="log">
      <LogToolbar eventId={ID} summary={summary} filters={filters} />
      <LogResults eventId={ID} summary={summary} filters={filters} page={page} />
    </EventTabFrame>
  );
}

const MISSING: LogFilters = { ...DEFAULT_FILTERS, view: "missing" };
const TERRACE_NOT_ON_LIST: LogFilters = { ...DEFAULT_FILTERS, result: "not_on_list", door: "terrace" };

export const logFrames: FrameDef[] = [
  adminFrame("A-09a", "A-09 Check-in log / live", W, H, () => <LogFrame summary={LOG_SUMMARY_LIVE} filters={DEFAULT_FILTERS} page={{ view: "all", scans: LOG_SCANS }} />),
  adminFrame("A-09b", "A-09 Check-in log / missing view", W, H, () => <LogFrame summary={LOG_SUMMARY_LIVE} filters={MISSING} page={{ view: "missing", guests: MISSING_GUESTS }} />),
  adminFrame("A-09c", "A-09 Check-in log / before doors open", W, H, () => (
    <LogFrame event={withStatus("open")} summary={LOG_SUMMARY_BEFORE} filters={DEFAULT_FILTERS} page={{ view: "all", scans: [] }} />
  )),
  adminFrame("A-09d", "A-09 Check-in log / filtered empty", W, H, () => (
    <LogFrame
      summary={fixtureSummary(LOG_SUMMARY_LIVE, TERRACE_NOT_ON_LIST)}
      filters={TERRACE_NOT_ON_LIST}
      page={{ view: "all", scans: filterScans(LOG_SCANS, TERRACE_NOT_ON_LIST) }}
    />
  )),
  // A-09e as drawn: the toolbar with its counts, rows loading (a filter change; the first load uses loading.tsx).
  adminFrame("A-09e", "A-09 Check-in log / loading", W, H, () => (
    <EventTabFrame event={BCN_OPENING} tab="log">
      <LogToolbar eventId={ID} summary={LOG_SUMMARY_LIVE} filters={DEFAULT_FILTERS} />
      <LogResults eventId={ID} summary={LOG_SUMMARY_LIVE} filters={DEFAULT_FILTERS} page={null} />
    </EventTabFrame>
  )),
];
