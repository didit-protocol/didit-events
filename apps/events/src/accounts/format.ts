/** Guest-area dates, always shown in Barcelona time (the account has no zone of its own). */
import { dayMonthYear } from "../public/format";

const TZ = "Europe/Madrid";

/** "1 Oct 2026" */
export const fullDate = (iso: string) => dayMonthYear(iso, TZ);
