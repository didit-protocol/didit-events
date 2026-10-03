import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type * as NavigationModule_ from "next/navigation";
type NavigationModule = typeof NavigationModule_;
// Kiosk frames use the app router (live pairing refresh); the static gallery render has none.
vi.mock("next/navigation", async (orig) => ({ ...(await orig<NavigationModule>()), useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} }) }));
import { FRAMES_APP, FrameView, getFrame } from "../../frames";
import { ADMIN_FRAME_CODES, adminFrames } from "./frames";

const letters = (code: string, ls: string) => ls.split("").map((l) => `${code}${l}`);

/** Every drawn frame of lane U2 (design/01 Admin + 01b Admin, A-08 excluded: U3 owns applicants). */
const DRAWN = [
  ...letters("A-01", "abcde"),
  ...letters("A-02", "abcd"),
  "A-02-1024",
  "A-02-390",
  ...letters("A-03", "abcd"),
  ...letters("A-04", "abcde"),
  ...letters("A-05", "abcd"),
  "A-05-1024",
  "A-05-390",
  ...letters("A-06", "abcdefg"),
  ...letters("A-07", "abcdef"),
  ...letters("A-09", "abcde"),
  ...letters("A-11", "ab"),
  ...letters("A-12", "abc"),
  ...letters("A-13", "abcdef"),
];

/** Undrawn frames (design-prompt §3): at least one frame each. */
const UNDRAWN = ["A-14", "A-15", "A-16", "A-17", "A-18", "A-19"];

/**
 * What each frame must actually draw: copy from its fixture / the design (text or, for skeleton-only loading frames,
 * the busy marker), plus text that must be absent when a frame differs from a sibling only by state.
 */
const BUSY = 'aria-busy="true"';
const CONTENT: Record<string, { has: string[]; not?: string[] }> = {
  "A-01a": { has: ["Sign in to Didit Events", "Continue with Google"], not: ["Signing in…"] },
  "A-01b": { has: ["Signing you in"] },
  "A-01c": { has: ["Google sign-in did not finish. If you opened this from an app (X, LinkedIn, Instagram), open it in Safari or Chrome, or use the email code."] },
  "A-01d": { has: ["Google sign-in did not finish. If you opened this from an app (X, LinkedIn, Instagram), open it in Safari or Chrome, or use the email code."] },
  "A-01e": { has: ["Your session has ended. Sign in again to continue. Your registrations are safe."] },
  "A-02a": { has: ["Barcelona Office Opening", "Madrid Fintech Breakfast", "124 invited · 98 verified · 42 in"] },
  "A-02b": { has: ['aria-label="Loading events"', "All 6"], not: ["Madrid Fintech Breakfast"] },
  "A-02c": { has: ["No events yet.", "Create your first event."] },
  "A-02d": { has: ["No events match “valencia”.", "Clear search"] },
  "A-02-1024": { has: ["Fri 23 Oct · 19:00–23:00", "Madrid Fintech Breakfast"] },
  "A-02-390": { has: ["124 invited · 98 verified · 42 in", "Madrid Fintech Breakfast"] },
  "A-03a": { has: ["Create event", "Drop an image or browse"] },
  "A-03b": { has: ["Fix 3 fields before saving.", "Give the event a name", "End must be after start"] },
  "A-03c": { has: ["Saving…"] },
  "A-03d": { has: ["Edit event", "✓ Saved · just now", "Save changes"] },
  "A-04a": { has: ["118 links sent", "+8 in last 15 min", "Peak 17 at 19:30"] },
  "A-04b": { has: ["Doors open in 2h 14m. Main door kiosk is paired and online."] },
  "A-04c": { has: ["Ended at 23:00. 104 of 124 guests checked in (84%).", "No-shows"] },
  "A-04d": { has: [BUSY], not: ["118 links sent"] },
  "A-04e": { has: ["No guests yet.", "Add people directly or share the request link."] },
  "A-17a": { has: ["Two close matches", "19:42:08", "Still missing"] },
  "A-05a": { has: ["2 selected", "Send links by email", "Registered as Maria Garcia Lopez", "Copy verification link"] },
  "A-05b": { has: [BUSY, "Search guests"], not: ["maria.garcia@gmail.com"] },
  "A-05c": { has: ["Filter · All 0"] },
  "A-05d": { has: ["Filter · In review 3", "Nobody named “okafor” is in review."] },
  "A-05-1024": { has: ["María García", "oliver.bennett@lucerne.test", "Verified · 20 Oct"] },
  "A-05-390": { has: ["María García", "oliver.bennett@lucerne.test"] },
  "A-06a": { has: ['aria-label="Loading guest"'], not: ["Questionnaire answers"] },
  "A-06b": { has: ["No answer", "Not verified yet", "verify.didit.me/s/7Hk2Qm"] },
  "A-06c": { has: ["In progress", "Open in Didit ↗"] },
  "A-06d": { has: ["A Didit reviewer is checking this session. Usually under 2 hours."] },
  "A-06e": { has: ["Declined by Didit.", "Declined by Didit · screen replay"] },
  "A-06f": { has: ["Head of Risk", "21 Oct 2026, 09:43", "Verified by Didit · 21 Oct 2026", "Doors not open yet"] },
  "A-06g": { has: ["23 Oct 2026, 19:42", "96% match", "Undo check-in"] },
  "A-07a": { has: ["Send the verification link now", "Add guest"] },
  "A-07b": { has: ["Paste CSV or rows: first, last, email", "Or drop a .csv file here. Header row is optional."] },
  "A-07c": { has: ["25 ready", "ingrid@initech.test"] },
  "A-07d": { has: ["23 ready", "1 invalid email", "1 duplicate"] },
  "A-07e": { has: ["Adding guests…", "14 of 23 · creating Didit verification links"] },
  "A-07f": { has: ["23 added, 2 skipped", "Download skipped rows"] },
  "A-14a": { has: ["Check in María García without face?"] },
  "A-14b": { has: ["Face didn’t match with glasses on. ID checked at the door.", "Manual check-in · Alberto"] },
  "A-15a": { has: ["Undo María García’s check-in?", "They show as missing again and can check in at the kiosk."] },
  "A-15b": { has: ["Check-in undone", "23 Oct 2026, 19:48"] },
  "A-16a": { has: ["Didit verified a different email.", "maria.garcia@globex.test", "Accept this email", "Ask to verify again"] },
  "A-09a": { has: ["All 186", "Welcomed 42", "Unknown face 3"] },
  "A-09b": { has: ["Amara Okafor", "+234 803 555 0142"] },
  "A-09c": { has: ["Scans will appear here once the door is running.", "All 0"] },
  "A-09d": { has: ["No scans match these filters.", "Nobody outside the list has been scanned at Terrace."] },
  "A-09e": { has: [BUSY, "All 186"], not: ["No scans match these filters."] },
  "A-11a": { has: ["Wi-Fi: Didit-Guest · password EXAMPLE-WIFI-PASSWORD", "End event"], not: ["Delete Barcelona Office Opening?"] },
  "A-11b": { has: ["Delete Barcelona Office Opening?", "Type the event name to confirm"] },
  "A-18a": { has: ["Scan budget per day", "186 of 500 scans today"] },
  "A-18b": { has: ["452 of 500 scans today"] },
  "A-12a": { has: ["pau.soler@didit.me", "Joan Colomé"] },
  "A-12b": { has: [BUSY, "LAST ACTIVE"], not: ["pau.soler@didit.me"] },
  "A-12c": { has: ["Only you so far.", "Teammates appear here after their first sign-in."] },
  "A-19a": { has: ["Invite sent to marta.vidal@didit.me. They can sign in with Google now."] },
  "A-19b": { has: ["Use a @didit.me address.", 'value="maria.garcia@gmail.com"'] },
  "A-19c": { has: ["Disable access for Joan Colomé?", "Disable access"] },
  "A-19d": { has: ["Disabled", "Restore"] },
  "A-13a": { has: ["Event not found", "Back to events"] },
  "A-13b": { has: ["No access", "Signed in as maria.garcia@gmail.com"] },
  "A-13c": { has: ["Something broke on our side", "500 · req_3f9a21"] },
  "A-13d": { has: ["You’re offline. Changes will sync when you’re back."] },
  "A-13e": { has: ["Didit is not responding.", "Status page ↗"] },
  "A-13f": { has: ["Your session expired", "Sign in again to keep working."] },
};

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

const labelOf = (html: string) => /data-screen-label="([^"]+)"/.exec(html)?.[1];

describe("U2 admin frames in /_frames", () => {
  it("registers every drawn frame code of the lane", () => {
    for (const code of DRAWN) expect(ADMIN_FRAME_CODES, code).toContain(code);
  });

  it("registers at least one frame for every undrawn admin frame A-14…A-19 (A-10/A-20 kiosk pairing went with Didit Access)", () => {
    for (const prefix of UNDRAWN) expect(ADMIN_FRAME_CODES.some((c) => c.startsWith(prefix)), prefix).toBe(true);
  });

  it("uses unique codes and unique labels", () => {
    expect(new Set(ADMIN_FRAME_CODES).size).toBe(ADMIN_FRAME_CODES.length);
    const labels = adminFrames.map((f) => labelOf(renderToStaticMarkup(<>{f.render()}</>)));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it.each(ADMIN_FRAME_CODES)("%s server-renders with its design label and viewport", (code) => {
    const def = getFrame(code, FRAMES_APP);
    expect(def, code).toBeDefined();
    const html = renderToStaticMarkup(<FrameView app={FRAMES_APP} code={code} />);
    const label = labelOf(html);
    expect(label, code).toBeDefined();
    expect(code.startsWith(label!.split(" ")[0]!)).toBe(true);
    expect(label).toBe(`${label!.split(" ")[0]} ${def!.name}`);
    expect(html).toContain(`width:${def!.viewport.w}px`);
    expect(html).toContain(`height:${def!.viewport.h}px`);
  });

  it("every frame code has expected content", () => {
    expect(Object.keys(CONTENT).sort()).toEqual([...ADMIN_FRAME_CODES].sort());
  });

  it.each(ADMIN_FRAME_CODES)("%s draws its fixture / design copy", (code) => {
    const html = decode(renderToStaticMarkup(<FrameView app={FRAMES_APP} code={code} />));
    const spec = CONTENT[code];
    expect(spec, code).toBeDefined();
    for (const text of spec!.has) expect(html, `${code} has “${text}”`).toContain(text);
    for (const text of spec!.not ?? []) expect(html, `${code} lacks “${text}”`).not.toContain(text);
  });
});
