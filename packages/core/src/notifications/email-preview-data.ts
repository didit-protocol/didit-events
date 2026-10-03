import type { EventEmailCode } from "../domain/event-model.ts";
import type { EmailEvent, Recipient } from "../email/common.ts";
import type { EmailDataByCode } from "../email/index.ts";
import { emailAssetsUrl,emailFontAssetsUrl } from "../email/media.ts";

/** Editorial previews use the selected event and inert links. They never mint guest tokens. */
export function previewData(code: EventEmailCode, event: EmailEvent, recipient: Recipient, baseUrl: string, inertUrl: string, assetsUrl = emailAssetsUrl(baseUrl), fontAssetsUrl = emailFontAssetsUrl(baseUrl)): EmailDataByCode[EventEmailCode] {
  const common = { baseUrl, assetsUrl, fontAssetsUrl, event, recipient };
  const samples: { [K in EventEmailCode]: EmailDataByCode[K] } = {
    "M-02": { ...common, replyBy: event.startsAt },
    "M-03": { ...common, verifyUrl: inertUrl, linkExpiresAt: event.startsAt },
    "M-05": { ...common, verifyUrl: inertUrl, deadline: event.startsAt, timeZone: event.timeZone },
    "M-06": { ...common, googleCalendarUrl: inertUrl, icsUrl: inertUrl, statusUrl:inertUrl,cancelUrl:inertUrl },
    "M-07": common,
    "M-08": { ...common, retryUrl: inertUrl, attemptsLeft: 1 },
    "M-09": { ...common, position: 1 },
    "M-10": { ...common, subscribeUrl: inertUrl },
    "M-11": { ...common, teaser: event.name, agenda: [], directionsUrl: inertUrl },
    "M-12": { ...common, directions: event.street, mapsUrl: inertUrl },
    "M-13": { ...common, checkedInAt: event.startsAt, arrivalNote: "Welcome. Your host will help you find your way.", tonight: [] },
    "M-14": { ...common, attendeeCount: 1, recap: { preheader: "Thanks for joining us.", line: "We hope to see you at another event." }, recordingsUrl: inertUrl, photosUrl: inertUrl },
    "M-15": { ...common, requestAgainUrl: inertUrl },
    "M-16": { ...common, change: { kind: "time", before: new Date(event.startsAt.getTime() - 15 * 60_000) }, calendarUrl: inertUrl },
    "M-19": { ...common, titleAccent: event.name, pitch: event.name, inviter: { firstName: "Your host" }, message: "We would love to see you there.", acceptUrl: inertUrl },
    "M-20": { ...common, kind: "cancelled", reason: "Plans changed", cancelledAt: event.startsAt, requestAgainUrl: inertUrl },
    "M-21": { ...common, otherEventsUrl: inertUrl },
    "M-23": { ...common, verifiedEmail: recipient.email, googleCalendarUrl: inertUrl, icsUrl: inertUrl, statusUrl: inertUrl, cancelUrl: inertUrl },
    "M-24": { ...common, guest: { name: recipient.firstName, email: recipient.email }, checkedInAt: event.startsAt, checkedInBy: "Host", undoneAt: event.startsAt, undoneBy: { name: "Host", role: "Staff" }, reason: "Entry corrected", checkInLogUrl: inertUrl },
  };
  return samples[code];
}
