"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, ClientButtonLink, TextField } from "@didit-events/ui";
import { adminLinks } from "../admin/links";
import { useCsrf } from "../auth/CsrfField";
import { doorApi } from "./kiosk/client";
import s from "./Door.module.css";

const STATION_KEY = "didit-door-station";
const noSubscription = () => () => {};
const readSavedStation = () => { try { return localStorage.getItem(STATION_KEY); } catch { return null; } };

/** Start-error codes from POST /api/door/{event}/start, in staff words. */
const START_ERRORS: Record<string, string> = {
  FaceCheckinOff: "Face check-in is off for this event. A host can turn it on in the event’s Door settings; until then, check guests in by hand from the guest list.",
  AccountSessionRequired: "Sign in with your account (Google or an email code) to start the door.",
  InvalidStation: "Name this door, for example “Main door” (up to 40 characters).",
  EventForbidden: "Your role on this event can’t run the door.",
  StaffForbidden: "Your role on this event can’t run the door.",
  CsrfRequired: "This page expired. Reload it and try again.",
  BrowserSessionAndCsrfRequired: "This page expired. Reload it and try again.",
  InvalidBrowserBinding: "This page expired. Reload it and try again.",
  StaffSessionRequired: "You were signed out. Sign in again to start the door.",
};

/**
 * "Start door mode": pick a station name and lock this browser to the event's door. The admin session on this device
 * ends; leaving door mode needs a sign-in (any team member with door access) or the staff PIN.
 */
export function DoorLauncher({ eventId, eventName, initialStation, resume, notice }: { eventId: string; eventName: string; initialStation?: string; resume?: boolean; notice?: string }) {
  const csrf = useCsrf();
  // The URL's door name (re-sign-in from the door), else the last one used on this device, until someone types.
  const saved = useSyncExternalStore(noSubscription, readSavedStation, () => null);
  const [typed, setStation] = useState<string | null>(null);
  const station = typed ?? initialStation ?? saved ?? "";
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const started = useRef(false);

  async function start(name: string) {
    setState({ busy: true, error: null });
    try {
      const res = await fetch(`${doorApi(eventId)}/start`, { method: "POST", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ station: name }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; requestId?: string; door?: string };
      if (!res.ok) {
        const message = START_ERRORS[body.error ?? ""] ?? (res.status === 401 ? START_ERRORS.StaffSessionRequired! : `Couldn’t start the door${body.requestId ? ` (ref ${body.requestId})` : ""}. Try again.`);
        return setState({ busy: false, error: message });
      }
      try { localStorage.setItem(STATION_KEY, name); } catch { /* private mode */ }
      // A full page load on purpose: starting the door swaps the admin session for the door cookie server-side.
      window.location.assign(body.door ?? adminLinks.kiosk(eventId));
    } catch {
      setState({ busy: false, error: navigator.onLine === false ? "No internet connection. Connect and try again." : "Couldn’t start the door. Try again." });
    }
  }

  // After a re-sign-in from the door (?resume=1), restart the same station without another click.
  useEffect(() => {
    if (resume && initialStation && !started.current) { started.current = true; void start(initialStation); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, initialStation]);

  return (
    <form className={s.launcher} onSubmit={(e) => { e.preventDefault(); if (station.trim()) void start(station.trim()); else setState({ busy: false, error: START_ERRORS.InvalidStation! }); }} aria-labelledby="door-start-title">
      <h2 id="door-start-title" className={s.title}>Start door mode</h2>
      {notice ? <p className={s.notice} role="status">{notice}</p> : null}
      <p className={s.lead}>
        This device becomes the face check-in door for <b>{eventName}</b>. You’ll be signed out of the admin here, so a laptop left at the entrance opens nothing else.
      </p>
      <TextField label="Door name" name="station" value={station} maxLength={40} required onChange={(e) => setStation(e.target.value)} hint="Shown in the check-in log, e.g. “Main door” or “Side entrance”." />
      {state.error ? <p className={s.error} role="alert">{state.error}</p> : null}
      <div className={s.actions}>
        <Button type="submit" loading={state.busy} disabled={state.busy}>Start door mode</Button>
        <ClientButtonLink variant="secondary" href={`/admin/events/${encodeURIComponent(eventId)}`}>Back to the event</ClientButtonLink>
      </div>
      <p className={s.help}>
        To leave door mode, press <kbd>O</kbd> on the door and sign in again, or use the event’s door PIN if staff set one. Before doors open (or after the event), turn on Test mode in the same panel to try it: nobody is checked in.
      </p>
    </form>
  );
}
