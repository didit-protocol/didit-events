/** Lane U2 frames (A-01…A-07, A-09, A-11…A-19) for the events /_frames gallery. Each admin area owns its list. */
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { formFrames } from "./form/frames";
import { guestsFrames } from "./guests/frames";
import { listFrames } from "./list/frames";
import { logFrames } from "./log/frames";
import { loginFrames } from "./login/frames";
import { overviewFrames } from "./overview/frames";
import { settingsFrames } from "./settings/frames";
import { systemFrames } from "./system/frames";
import { teamFrames } from "./team/frames";

export const adminFrames: FrameDef[] = [
  ...loginFrames,
  ...listFrames,
  ...formFrames,
  ...overviewFrames,
  ...guestsFrames,
  ...logFrames,
  ...settingsFrames,
  ...teamFrames,
  ...systemFrames,
];

export const ADMIN_FRAME_CODES = adminFrames.map((f) => f.code);
