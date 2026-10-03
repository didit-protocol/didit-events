import { interpolateEditorial } from "../content/markdown.ts";
import { emailOverride,type EmailOverride } from "../domain/event-model.ts";
// Email templates M-01…M-29, E-01…E-03 and T-01 (team invite). Each template exports { subject, html, text } over typed data;
// `renderEmail(code, data)` is what the outbox dispatcher (B5) calls.
import type { EmailBase,EmailCode,EmailEvent,EmailTemplate,Recipient,Sender } from "./common.ts";
import { fitSubject,renderHtml,renderText } from "./layout.ts";
import { E01,type E01Data } from "./templates/E-01.ts";
import { E02,type E02Data } from "./templates/E-02.ts";
import { E03,type E03Data } from "./templates/E-03.ts";
import { M01,type M01Data } from "./templates/M-01.ts";
import { M02,type M02Data } from "./templates/M-02.ts";
import { M03,type M03Data } from "./templates/M-03.ts";
import { M04,type M04Data } from "./templates/M-04.ts";
import { M05,type M05Data } from "./templates/M-05.ts";
import { M06,type M06Data } from "./templates/M-06.ts";
import { M07,type M07Data } from "./templates/M-07.ts";
import { M08,type M08Data } from "./templates/M-08.ts";
import { M09,type M09Data } from "./templates/M-09.ts";
import { M10,type M10Data } from "./templates/M-10.ts";
import { M11,type M11Data } from "./templates/M-11.ts";
import { M12,type M12Data } from "./templates/M-12.ts";
import { M13,type M13Data } from "./templates/M-13.ts";
import { M14,type M14Data } from "./templates/M-14.ts";
import { M15,type M15Data } from "./templates/M-15.ts";
import { M16,type M16Data } from "./templates/M-16.ts";
import { M17,type M17Data } from "./templates/M-17.ts";
import { M18,type M18Data } from "./templates/M-18.ts";
import { M19,type M19Data } from "./templates/M-19.ts";
import { M20,type M20Data } from "./templates/M-20.ts";
import { M21,type M21Data } from "./templates/M-21.ts";
import { M22,type M22Data } from "./templates/M-22.ts";
import { M23,type M23Data } from "./templates/M-23.ts";
import { M24,type M24Data } from "./templates/M-24.ts";
import { M25,type M25Data } from "./templates/M-25.ts";
import { M26,type M26Data } from "./templates/M-26.ts";
import { M27,type M27Data } from "./templates/M-27.ts";
import { M28,type M28Data } from "./templates/M-28.ts";
import { M29,type M29Data } from "./templates/M-29.ts";
import { T01,type T01Data } from "./templates/T-01.ts";

export interface EmailDataByCode {
  "M-01": M01Data;
  "M-02": M02Data;
  "M-03": M03Data;
  "M-04": M04Data;
  "M-05": M05Data;
  "M-06": M06Data;
  "M-07": M07Data;
  "M-08": M08Data;
  "M-09": M09Data;
  "M-10": M10Data;
  "M-11": M11Data;
  "M-12": M12Data;
  "M-13": M13Data;
  "M-14": M14Data;
  "M-15": M15Data;
  "M-16": M16Data;
  "M-17": M17Data;
  "M-18": M18Data;
  "M-19": M19Data;
  "M-20": M20Data;
  "M-21": M21Data;
  "M-22": M22Data;
  "M-23": M23Data;
  "M-24": M24Data;
  "M-25": M25Data;
  "M-26": M26Data;
  "M-27": M27Data;
  "M-28": M28Data;
  "M-29": M29Data;
  "E-01": E01Data;
  "E-02": E02Data;
  "E-03": E03Data;
  "T-01": T01Data;
}

export const emailTemplates: { [C in EmailCode]: EmailTemplate<EmailDataByCode[C]> } = {
  "M-01": M01,
  "M-02": M02,
  "M-03": M03,
  "M-04": M04,
  "M-05": M05,
  "M-06": M06,
  "M-07": M07,
  "M-08": M08,
  "M-09": M09,
  "M-10": M10,
  "M-11": M11,
  "M-12": M12,
  "M-13": M13,
  "M-14": M14,
  "M-15": M15,
  "M-16": M16,
  "M-17": M17,
  "M-18": M18,
  "M-19": M19,
  "M-20": M20,
  "M-21": M21,
  "M-22": M22,
  "M-23": M23,
  "M-24": M24,
  "M-25": M25,
  "M-26": M26,
  "M-27": M27,
  "M-28": M28,
  "M-29": M29,
  "E-01": E01,
  "E-02": E02,
  "E-03": E03,
  "T-01": T01,
};

export const EMAIL_CODES = Object.keys(emailTemplates) as EmailCode[];

/**
 * Sent by Didit, not by our outbox: M-01 and M-17 are Didit's standalone email OTP (white-label), M-04 is the code
 * inside Didit's hosted flow. The templates are the reference copy for Didit's branding settings and the previews.
 */
export const DIDIT_SENT_CODES: readonly EmailCode[] = ["M-01", "M-04", "M-17"];

export interface RenderedEmail {
  from: Sender;
  subject: string;
  /** Inbox preview line (already hidden at the top of `html`). */
  preheader: string;
  html: string;
  text: string;
}

export function renderEmail<C extends EmailCode>(code: C, data: EmailDataByCode[C], override?: EmailOverride): RenderedEmail {
  const t = emailTemplates[code] as EmailTemplate<EmailBase>;
  const doc = t.doc(data);
  if (override) {
    const safe=emailOverride.parse(override), d=data as unknown as Record<string,unknown>;
    const event=d.event as EmailEvent|undefined,recipient=d.recipient as Recipient|undefined;
    const values={first_name:recipient?.firstName,event_name:event?.name,date:event?.startsAt.toLocaleDateString("en-GB",{timeZone:event.timeZone}),time:event?.startsAt.toLocaleTimeString("en-GB",{timeZone:event.timeZone}),venue:event?.venueName,maps_url:typeof d.mapsUrl==="string"?d.mapsUrl:""};
    if(safe.subject)doc.subject=interpolateEditorial(safe.subject,values);
    if(safe.body_md!==undefined){doc.body="";doc.blocks.unshift({kind:"markdown",source:interpolateEditorial(safe.body_md,values,true)});}
  }
  return { from: t.from, subject: fitSubject(doc.subject), preheader: doc.preheader.replace(/[ \t]{2,}/g, " ").trim(), html: renderHtml(doc), text: renderText(doc) };
}

export { DIDIT_SENDER,EVENTS_SENDER,type EmailBase,type EmailCode,type EmailEvent,type EmailTemplate,type Recipient,type Sender } from "./common.ts";
export * from "./format.ts";
export type { EmailDoc } from "./layout.ts";
export { initialsOf,type HostApplicant,type HostRequestCounts } from "./templates/M-25.ts";
export { PROFILE_GAPS,type ProfileGap } from "./templates/M-29.ts";
export type {
E01Data,E02Data,E03Data,M01Data,M02Data,M03Data,M04Data,M05Data,M06Data,M07Data,M08Data,M09Data,M10Data,M11Data,M12Data,
M13Data,M14Data,M15Data,M16Data,M17Data,M18Data,M19Data,M20Data,M21Data,M22Data,M23Data,M24Data,M25Data,M26Data,M27Data,M28Data,M29Data,T01Data
};
