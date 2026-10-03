import { defineTemplate, type EmailBase, type EmailEvent, type Recipient } from "../common.ts";
import { M03 } from "./M-03.ts";

export interface E01Data extends EmailBase {
  recipient: Recipient;
  event: EmailEvent;
  verifyUrl: string;
  linkValidDays: number;
}

export const E01 = defineTemplate<E01Data>({ code: "E-01", name: "Renew a required check", trigger: "legacy alias of M-03" }, d => M03.doc({...d,linkExpiresAt:d.event.startsAt}));
