import { defineTemplate, type EmailBase, type EmailEvent, type Recipient } from "../common.ts";
import { M13 } from "./M-13.ts";
import type { AgendaItem } from "./M-11.ts";

export interface E02Data extends EmailBase {
  recipient: Recipient;
  event: EmailEvent;
  checkedInAt: Date;
  /** "Grab a drink, the team is on the ground floor." */
  arrivalNote: string;
  tonight: AgendaItem[];
}

export const E02 = defineTemplate<E02Data>({ code:"E-02", name:"Welcome · checked in", trigger:"legacy alias of M-13" }, d => M13.doc(d));
