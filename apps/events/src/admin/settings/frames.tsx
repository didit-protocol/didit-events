/** A-11 Settings (design/01b Admin, 1440×960) and A-18 Spend and limits (undrawn, design-prompt §3). */
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { BCN_OPENING } from "../fixtures";
import { EventTabFrame } from "../event/EventTabFrame";
import { adminFrame } from "../frame";
import { DeleteEventDialog } from "./DeleteEventDialog";
import { BCN_SETTINGS } from "./fixtures";
import { SettingsView } from "./SettingsView";
import type { EventSettings } from "./types";
import s from "./Settings.module.css";

const W = 1440;
const NEAR_CAP: EventSettings = { ...BCN_SETTINGS, limits: { ...BCN_SETTINGS.limits, scansToday: 452, mode: "strict", strictness: 90 } };

function SettingsFrame({ settings: settingsProps, overlay }: { settings: EventSettings; overlay?: boolean }) {
  return (
  <EventTabFrame
    event={BCN_OPENING}
    tab="settings"
    overlay={
      overlay ? (
        <div className={s.frameScrim}>
          <DeleteEventDialog eventId={BCN_OPENING.id} name={BCN_OPENING.name} guestCount={BCN_OPENING.guestCount} open inline typed="Barcelona Office Open" />
        </div>
      ) : undefined
    }
  >
    <SettingsView settings={settingsProps} />
  </EventTabFrame>
  );
}

export const settingsFrames: FrameDef[] = [
  adminFrame("A-11a", "A-11 Settings", W, 960, () => <SettingsFrame settings={BCN_SETTINGS} />),
  adminFrame("A-11b", "A-11 Settings / delete confirm", W, 960, () => <SettingsFrame settings={BCN_SETTINGS} overlay />),
  // A-18: the whole settings page, tall enough to show the Spend and limits section (80% of the budget used).
  adminFrame("A-18a", "A-18 Spend and limits", W, 1400, () => <SettingsFrame settings={BCN_SETTINGS} />),
  adminFrame("A-18b", "A-18 Spend and limits / near the cap", W, 1400, () => <SettingsFrame settings={NEAR_CAP} />),
];
