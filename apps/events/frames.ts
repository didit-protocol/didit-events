// Frame registry for the events app's /_frames gallery. Importing @didit-events/ui/frames registers the shared
// foundation frames (T-00, C-00); each lane adds this app's frames here with registerFrames([...]).
import { registerFrames } from "@didit-events/ui/frames";
import { accountFrames } from "./src/accounts/frames";
import { adminFrames } from "./src/admin/frames";
import { applicantFrames } from "./src/admin/applicants/frames";
import { kioskFrames } from "./src/door/kiosk/frames";
import { emailFrames } from "./src/emails/frames";
import { publicFrames } from "./src/public/frames";

registerFrames(publicFrames);
registerFrames(emailFrames);
registerFrames(accountFrames);
registerFrames(adminFrames);
registerFrames(applicantFrames);
registerFrames(kioskFrames);

export { framesEnabled, FrameIndex, FrameView, getFrame } from "@didit-events/ui/frames";

export const FRAMES_APP = "events" as const;
