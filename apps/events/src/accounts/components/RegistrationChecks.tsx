"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button, Checkbox } from "@didit-events/ui";
import type { GuestRegistrationView, VerificationLaunch } from "@didit-events/core/contracts/event-model";
import { apiCall } from "../api-client";
import { actionCsrf } from "../../auth/client";
import s from "./Screen.module.css";
import a from "./Account.module.css";

export function RegistrationChecks({ registration }: { registration: GuestRegistrationView }) {
  const router=useRouter();
  const consentId = useId();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = `/me/events/${encodeURIComponent(registration.slug)}`;
  async function start() {
    setBusy(true);
    const result = await apiCall<VerificationLaunch>(`/api/registrations/${registration.id}/renew`, {
      method: "POST", body: JSON.stringify({ strategy: "minimal", consent: {
        disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, eventConsentAccepted: false,
        acceptedChecks: ["face", "phone", "id_document", "name_from_id", "age"].filter(check => check === "face" || registration.missing.some(m => m.check === check)),
      } }),
    }, actionCsrf);
    setBusy(false);
    if (!result.ok) return setMessage(result.error.message);
    if (result.data.state === "ready") return window.location.assign(result.data.url);
    if (result.data.state === "not_needed") return router.push(status);
    setMessage(result.data.state === "creating" ? "Your check is being prepared. Continue again in a few seconds." : "This check needs review. Contact the host for help.");
  }
  return (
    <>
      <div className={s.consent}>
        <Checkbox id={consentId} size="lg" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <label htmlFor={consentId}>I agree to complete these checks with Didit and share the results with this event&apos;s hosts.</label>
      </div>
      {message ? (
        <p role="status" className={a.checksNote}>
          {message}
        </p>
      ) : null}
      <Button size="xl" block disabled={!accepted || busy} loading={busy} onClick={() => void start()}>
        Continue checks
      </Button>
    </>
  );
}
