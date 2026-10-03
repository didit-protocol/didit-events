/** A-04 Overview (design/01 Admin, 1440×960) and A-17 Live door panel (undrawn, design-prompt §3). */
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { BCN_OPENING, withStatus } from "../fixtures";
import { EventTabFrame } from "../event/EventTabFrame";
import { adminFrame } from "../frame";
import { OV_BEFORE, OV_EMPTY, OV_ENDED, OV_LIVE, OV_NOW_BEFORE, OV_NOW_ENDED, OV_NOW_LIVE } from "./fixtures";
import { OverviewLoading, OverviewView } from "./OverviewView";

const W = 1440;
const H = 960;

export const overviewFrames: FrameDef[] = [
  adminFrame("A-04a", "A-04 Overview / live", W, H, () => (
    <EventTabFrame event={BCN_OPENING} tab="overview">
      <OverviewView data={OV_LIVE} now={OV_NOW_LIVE} />
    </EventTabFrame>
  )),
  adminFrame("A-04b", "A-04 Overview / before the event", W, H, () => (
    <EventTabFrame event={withStatus("open")} tab="overview">
      <OverviewView data={OV_BEFORE} now={OV_NOW_BEFORE} />
    </EventTabFrame>
  )),
  adminFrame("A-04c", "A-04 Overview / ended", W, H, () => (
    <EventTabFrame event={withStatus("ended")} tab="overview">
      <OverviewView data={OV_ENDED} now={OV_NOW_ENDED} />
    </EventTabFrame>
  )),
  adminFrame("A-04d", "A-04 Overview / loading", W, H, () => (
    <EventTabFrame event={BCN_OPENING} tab="overview">
      <OverviewLoading />
    </EventTabFrame>
  )),
  adminFrame("A-04e", "A-04 Overview / empty", W, H, () => (
    <EventTabFrame event={withStatus("draft")} tab="overview">
      <OverviewView data={OV_EMPTY} now={OV_NOW_BEFORE} />
    </EventTabFrame>
  )),
  // A-17: the live overview with the door panel under the funnel (taller box so the charts keep their height).
  adminFrame("A-17a", "A-17 Live door panel", W, 1180, () => (
    <EventTabFrame event={BCN_OPENING} tab="overview">
      <OverviewView data={OV_LIVE} now={OV_NOW_LIVE} doorPanel />
    </EventTabFrame>
  )),
];
