import { M02 } from "./M-02.ts";
import { defineTemplate, type EmailBase, type EmailEvent, type Recipient } from "../common.ts";

export interface E03Data extends EmailBase {
  recipient: Recipient;
  event: EmailEvent;
}

export const E03 = defineTemplate<E03Data>({ code:"E-03", name:"Request received", trigger:"legacy alias of M-02" }, d => M02.doc({...d,replyBy:d.event.startsAt}));
