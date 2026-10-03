"use client";
import { actionCsrf } from "../../auth/client";

import { useState, useTransition } from "react";
import { Button, Modal, Select, Switch, toast } from "@didit-events/ui";
import { saveRequirementsAction } from "../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions";
import { handleSessionExpired } from "../system/session";
import { useAdminRouter } from "../useAdminRouter";
import type { RequirementSettings } from "./types";
import s from "./Applicants.module.css";

const MONTHS: RequirementSettings["reuseMonths"][] = [3, 6];

/** One compact requirement: label + one-line hint on the left, the switch on the right; locked rows stay on. */
function ReqRow({ label, hint, checked, onChange, locked }: { label: string; hint: string; checked: boolean; onChange?: (v: boolean) => void; locked?: boolean }) {
  return (
    <Switch
      className={s.reqRow}
      labelPosition="start"
      label={label}
      hint={hint}
      checked={checked}
      disabled={locked}
      onChange={(e) => onChange?.(e.currentTarget.checked)}
    />
  );
}

/** AP-27 "What guests must verify" (event settings). The selfie stays on: face check-in needs it. */
export function RequirementsModal({ eventId, initial, closeHref, inline }: { eventId: string; initial: RequirementSettings; closeHref: string; inline?: boolean }) {
  const router = useAdminRouter();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const close = () => router.push(closeHref, { scroll: false });
  const set = <K extends keyof RequirementSettings>(k: K) => (value: RequirementSettings[K]) => setV((x) => ({ ...x, [k]: value }));
  const save = () =>
    start(async () => {
      setError(undefined);
      const r = await saveRequirementsAction(eventId, v, actionCsrf()).catch(() => ({ error: "invalid" as const }));
      if (handleSessionExpired(r)) return;
      if ("error" in r) {
        setError(r.error === "conflict" ? "This event changed since you opened it. Close and reopen to see the latest requirements." : "Couldn’t save the requirements. Try again.");
        return;
      }
      toast({ message: "Requirements saved. Approved guests keep their place." });
      router.refresh();
      close();
    });
  return (
    <Modal
      open
      inline={inline}
      onClose={close}
      title="What guests must verify"
      closeLabel="Close"
      width={600}
      className={`${s.modal} ${s.reqModal}`}
      description="Guests with these already verified at Didit skip straight to their ticket."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            Save requirements
          </Button>
        </>
      }
    >
      <div className={s.reqGrid}>
        <ReqRow label="Email" hint="Always on · one-time code" checked locked />
        <ReqRow label="Selfie · liveness" hint="Always on · face check-in" checked locked />
        <ReqRow label="Full name" hint="Matched to the selfie" checked={v.name} onChange={set("name")} />
        <ReqRow label="Age 18+" hint="Events serving alcohol" checked={v.age18} onChange={set("age18")} />
        <ReqRow label="ID document" hint="Not available for this event" checked={false} locked />
      </div>
      <div className={s.reqReuse}>
        <span>
          <b>Reuse verifications</b>
          <span>Older checks are asked again.</span>
        </span>
        <Select
          label="Reuse verifications newer than"
          hideLabel
          className={s.select}
          value={String(v.reuseMonths)}
          onChange={(e) => set("reuseMonths")(Number(e.currentTarget.value) as RequirementSettings["reuseMonths"])}
          options={MONTHS.map((m) => ({ value: String(m), label: `Newer than ${m} months` }))}
        />
      </div>
      {error ? (
        <p role="alert" className={s.fieldError}>
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
