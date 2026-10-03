import type { ReactNode } from "react";
import Link from "next/link";
import { TextField } from "@didit-events/ui";
import { adminLinks } from "../links";
import { DangerZone } from "./DangerZone";
import { LazyDetailsForm } from "./LazyDetails";
import { LimitsForm } from "./LimitsForm";
import { RequestFormToggle } from "./RequestFormToggle";
import { SettingsNav } from "./SettingsNav";
import type { EventSettings } from "./types";
import { WelcomeEmailForm } from "./WelcomeEmailForm";
import s from "./Settings.module.css";

const SECTIONS = [
  { id: "details", label: "Event details" },
  { id: "request-form", label: "Request form" },
  { id: "welcome-email", label: "Welcome email" },
  { id: "limits", label: "Spend and limits" },
  { id: "danger", label: "Danger zone", danger: true },
] as const;

/** A-11 Settings: event details summary, request form switch, welcome email, A-18 spend and limits, danger zone. */
export function SettingsView({ settings, requirements, hide = [] }: { settings: EventSettings; requirements?: ReactNode; /** Sections the viewer's role can't use (hosts: limits, danger). */ hide?: readonly ("limits" | "danger")[] }) {
  const id = settings.eventId;
  const shown = (key: string) => !hide.includes(key as "limits");
  return (
    <div className={s.layout}>
      <SettingsNav sections={(requirements ? [...SECTIONS.slice(0, 2), { id: "requirements", label: "Verification" } as const, ...SECTIONS.slice(2)] : SECTIONS).filter((sec) => shown(sec.id)).map((sec) => ({ id: sec.id, label: sec.label, danger: "danger" in sec }))} />
      <div className={s.content}>
        <section id="details" aria-labelledby="details-title" className={s.section}>
          <h2 id="details-title" className={s.title}>
            Event details
          </h2>
          {settings.details && settings.editVersion !== undefined ? (
            <LazyDetailsForm eventId={id} initial={settings.details} editVersion={settings.editVersion} readOnly={settings.ended} />
          ) : (
            <div className={s.detailsGrid}>
              <TextField label="Event name" hideLabel readOnly value={settings.name} />
              <TextField label="Date" hideLabel readOnly value={settings.date} />
              <TextField label="Time" hideLabel readOnly value={settings.time} />
            </div>
          )}
          <p className={s.note}>
            <Link href={adminLinks.editEvent(id)}>Edit all details</Link>
          </p>
        </section>

        <section id="request-form" aria-labelledby="request-form-title" className={s.section}>
          <div className={s.titleRow}>
            <h2 id="request-form-title" className={s.title}>
              Request form
            </h2>
            <RequestFormToggle eventId={id} open={settings.requestForm.open} editVersion={settings.editVersion} />
          </div>
          <div className={s.formBody}>
            <p className={s.formText}>
              Questions: {settings.requestForm.questions}
              <br />
              New guests join the waitlist when all {settings.requestForm.capacity} places are taken.
            </p>
            <div className={s.preview} aria-hidden="true">
              <span className={s.pvTitle} />
              <span className={s.pvSub} />
              <span className={s.pvField} />
              <span className={s.pvField} />
              <span className={s.pvButton} />
            </div>
          </div>
        </section>

        {requirements}

        <section id="welcome-email" aria-labelledby="welcome-title" className={s.section}>
          <h2 id="welcome-title" className={s.title}>
            Welcome email
          </h2>
          <WelcomeEmailForm eventId={id} welcome={settings.welcome} editVersion={settings.editVersion} />
        </section>

        {shown("limits") ? (
          <section id="limits" aria-labelledby="limits-title" className={s.section}>
            <h2 id="limits-title" className={s.title}>
              Spend and limits
            </h2>
            <LimitsForm eventId={id} limits={settings.limits} editVersion={settings.editVersion} />
          </section>
        ) : null}

        {shown("danger") ? (
          <section id="danger" aria-labelledby="danger-title" className={`${s.section} ${s.danger}`}>
            <h2 id="danger-title" className={s.title}>
              Danger zone
            </h2>
            <DangerZone eventId={id} name={settings.name} guestCount={settings.guestCount} ended={settings.ended} editVersion={settings.editVersion} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
