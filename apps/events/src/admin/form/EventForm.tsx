"use client";
import { CsrfField } from "../../auth/CsrfField";

import { useActionState, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Banner, Breadcrumbs, Button, ClientButtonLink, DatePicker, NumberField, Select, TextField, Textarea, TimeField, cx, formatDuration, isoDate, normalizeTime, timeToMinutes, todayYmd } from "@didit-events/ui";
import { adminLinks } from "../links";
import shell from "../shell/AdminShell.module.css";
import type { EditorCapabilities, EmailTemplateView } from "../model/contract";
import type { EventFormErrors, EventFormField, EventFormState, EventFormValues, WelcomePreview } from "./types";
import { CAPACITY_MAX, DESCRIPTION_MAX, NAME_MAX, eventStartLocal, fixFieldsMessage, isPristine, parseDate, previewOf, savedLabel, toIsoDate, validateEventField, validateEventForm } from "./validate";
import { DEFAULT_V2, sameValue, validateV2, type EditorV2 } from "./editor";
import { DESCRIPTION_MD_MAX } from "./url";
import { CoverField, coverSrc, type CoverUpload } from "./CoverField";
import { HostsField } from "./HostsField";
import { AgendaField, DoorSection, EmailEditor, FormBuilder, LeaveGuard, MarkdownEditor, VerificationSection } from "./lazy";
import type { EmailTransport } from "./emails";
import type { RenderMarkdown } from "./MarkdownEditor";
import { httpRenderMarkdown } from "./markdown-render";
import { LocationField, type PlacesFetch } from "./LocationField";
import { TimezoneField } from "./TimezoneField";
import s from "./EventForm.module.css";

export type EventFormAction = (prev: EventFormState, form: FormData) => Promise<EventFormState>;

export interface EventFormProps {
  mode: "new" | "edit";
  /** Breadcrumb tail: "New event" or the event name. */
  crumb: string;
  cancelHref: string;
  action: EventFormAction;
  initialState: EventFormState;
  /** Edit mode: the event id (posted as a hidden field). */
  eventId?: string;
  /** @deprecated The Emails section previews M-13 with the real renderer; kept so older callers type-check. */
  welcome?: WelcomePreview;
  /** Event lifecycle: a draft (or a new event) arms the leave-page guard even without unsaved changes. */
  status?: "draft" | "published" | "live" | "ended" | "cancelled";
  /** Optimistic edit version (EventEditorView.editVersion) for previews, test sends and cover uploads. */
  editVersion?: number;
  /** Provider capabilities for the extra checks (EventEditorView.capabilities). */
  capabilities?: EditorCapabilities;
  /** Registrations per accepted policy version ("Applies to new requests"). */
  acceptedPolicyCounts?: { policyVersion: number; registrations: number }[];
  /** Email rows from the loader (EventEditorView.emails). */
  emailTemplates?: EmailTemplateView[];
  /** The stored cover's URL (EventEditorView.coverUrl). */
  coverUrl?: string | null;
  /** Frame gallery: force the in-flight look (A-03c). */
  forcePending?: boolean;
  /** Frame gallery: the clock for "Saved · just now". */
  now?: Date;
  /** GOOGLE_MAPS_API_KEY is set on the server: the Location field searches Google Maps. */
  placesEnabled?: boolean;
  /** Tests: fake Places transport. */
  placesFetch?: PlacesFetch;
  /** Tests: fake email and cover transports. */
  emailTransport?: EmailTransport;
  coverUpload?: CoverUpload;
  /** Tests: the description Preview renderer (defaults to the public page's renderer over HTTP). */
  renderMarkdown?: RenderMarkdown;
}

/** Fail closed if a caller omits capability discovery. */
const UNKNOWN_CAPABILITIES: EditorCapabilities = { phone: false, document: false, age: false, reason: "Save the event and refresh to check provider availability." };

/** Field order on screen: the first invalid one gets focus on submit. */
const FIELD_ORDER: EventFormField[] = ["name", "date", "start", "end", "timezone", "venue", "address", "street", "city", "postalCode", "country", "capacity", "description", "cover", "descriptionMd", "agenda", "registration", "questions", "verification", "door", "emails"];

const SECTIONS = [
  { id: "details", label: "Details" },
  { id: "description", label: "Description" },
  { id: "agenda", label: "Agenda" },
  { id: "registration", label: "Registration form" },
  { id: "verification", label: "Verification" },
  { id: "door", label: "Door" },
  { id: "emails", label: "Emails" },
] as const;
const FIELD_SECTION: Partial<Record<EventFormField, (typeof SECTIONS)[number]["id"]>> = { descriptionMd: "description", agenda: "agenda", registration: "registration", questions: "registration", verification: "verification", door: "door", emails: "emails" };

const opt = (text: string) => <span className={s.opt}>{text}</span>;
const withV2 = (v: EventFormValues): EventFormValues => ({ ...v, date: toIsoDate(v.date) || v.date, v2: v.v2 ?? structuredClone(DEFAULT_V2) });

/**
 * A-03 New / edit event, model v2: Details, Description (Markdown), Registration form, Verification, Door and
 * Emails on one page, over one server action (useActionState). The server validates with the same rules; the
 * client keeps the typed values for the previews, inline errors and the dirty state behind the leave-page guard.
 */
export function EventForm({ mode, crumb, cancelHref, action, initialState, eventId, status, editVersion, capabilities = UNKNOWN_CAPABILITIES, acceptedPolicyCounts, emailTemplates, coverUrl, forcePending, now, placesEnabled = false, placesFetch, emailTransport, coverUpload, renderMarkdown }: EventFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [currentVersion, setCurrentVersion] = useState(editVersion ?? 1);
  const [values, setValues] = useState<EventFormValues>(() => withV2(initialState.values));
  // The last saved values: the dirty state compares against them (a failed save keeps the page dirty).
  const [baseline, setBaseline] = useState(values);
  const [submitted, setSubmitted] = useState<EventFormValues | null>(null);
  // Client-side messages (blur / submit), replaced by the server's on every action result.
  const [clientErrors, setClientErrors] = useState<EventFormErrors | null>(null);
  const [reported, setReported] = useState(state);
  if (reported !== state) {
    setReported(state);
    setClientErrors(null);
    if (state.status === "saved" && submitted) { setBaseline(state.values); setValues(state.values); if(state.editVersion) setCurrentVersion(state.editVersion); }
  }
  const formRef = useRef<HTMLFormElement>(null);
  // The section tabs scroll sideways when they do not fit: `navMore` drives the edge fade that says so.
  const navRef = useRef<HTMLElement>(null);
  const [navMore, setNavMore] = useState<boolean | null>(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => setNavMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverPending, setCoverPending] = useState(false);
  const ids = useId();
  const render = useMemo(() => renderMarkdown ?? httpRenderMarkdown(mode === "edit" ? eventId : undefined), [renderMarkdown, mode, eventId]);

  const v2 = values.v2!;
  const pending = forcePending || isPending;
  const errors: EventFormErrors = clientErrors ?? (state.status === "invalid" ? state.errors : {});
  const errorCount = Object.keys(errors).filter((k) => errors[k as EventFormField]).length;
  // Item-level v2 messages (question labels, choices, email subjects) shown once the section has an error.
  const v2Errors = validateV2(v2, eventStartLocal(values), values.timezone);
  const shownV2 = (field: EventFormField, keys: (k: string) => boolean) => (errors[field] ? Object.fromEntries(Object.entries(v2Errors).filter(([k]) => keys(k))) : {});
  const registrationErrors = shownV2("registration", (k) => k.startsWith("q:") || ["questions", "consent", "closesAt"].includes(k));

  const set = <K extends keyof EventFormValues>(k: K, v: EventFormValues[K]) => {
    const next = { ...values, [k]: v };
    setValues(next);
    // A shown error clears (or updates) as soon as the value changes; new errors wait for blur or submit.
    if (errors[k as EventFormField]) setClientErrors({ ...errors, [k]: validateEventField(k as EventFormField, next) });
  };
  const setV2 = (p: Partial<EditorV2>, field?: EventFormField) => {
    const nextV2 = { ...v2, ...p };
    const next = { ...values, v2: nextV2 };
    setValues(next);
    if (field && errors[field]) setClientErrors({ ...errors, [field]: validateEventForm(next)[field] });
  };
  const patch = (p: Partial<EventFormValues>) => {
    const next = { ...values, ...p };
    setValues(next);
    const touched = Object.keys(p).filter((k) => errors[k as EventFormField] || (k === "address" || k === "street") && errors.address);
    if (touched.length) {
      const fresh = validateEventForm(next);
      setClientErrors({ ...errors, ...Object.fromEntries(["venue", "address", "street", "city", "postalCode", "country"].map((k) => [k, fresh[k as EventFormField]])) });
    }
  };
  /** Blur: run that field's rule (and the dependent end-time rule when the start changes). */
  const blur = (k: EventFormField, current = values) => {
    const next: EventFormErrors = { ...errors, [k]: validateEventField(k, current) };
    if (k === "start" && current.end.trim()) next.end = validateEventField("end", current);
    setClientErrors(next);
  };
  const text = (k: "name" | "description") => ({
    name: k,
    value: values[k],
    error: errors[k],
    readOnly: pending,
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
    onBlur: () => blur(k),
  });

  /** Runs the client rules; on failure shows them and focuses the first invalid field. Returns whether it is valid. */
  const check = (): boolean => {
    const found = validateEventForm(values);
    if (!Object.keys(found).length) return true;
    setClientErrors(found);
    const first = FIELD_ORDER.find((f) => found[f]);
    const section = first ? FIELD_SECTION[first] : undefined;
    const el = first
      ? formRef.current?.querySelector<HTMLElement>(`[data-field~="${first}"] :is(input:not([type=hidden]), button, select, textarea)`) ?? (section ? document.getElementById(`${ids}-${section}`) : null)
      : null;
    el?.focus();
    // Bring the invalid section's tab into view in the (sideways-scrolling) section nav.
    navRef.current?.querySelector<HTMLElement>(`[data-section="${section ?? "details"}"]`)?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    return false;
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (!check()) return e.preventDefault();
    setSubmitted(values);
  };
  const saveDraft = () => {
    if (!check()) return false;
    formRef.current?.requestSubmit();
    return true;
  };

  const date = parseDate(values.date);
  const preview = previewOf(values);
  const dirty = coverPending || !sameValue(values, baseline);
  const disabled = pending || (mode === "new" && isPristine(values, baseline) && !coverPending && state.status === "idle");
  const today = isoDate(todayYmd());
  const saveLabel = pending ? "Saving…" : mode === "new" ? "Create event" : "Save changes";
  const appliesToNew = (acceptedPolicyCounts ?? []).some((p) => p.registrations > 0);
  const startMin = timeToMinutes(values.start), endMin = timeToMinutes(values.end);
  const duration = startMin !== null && endMin !== null && endMin > startMin ? formatDuration(endMin - startMin) : null;
  /** Status, Cancel and Save: in the page head, and again in the bottom save bar (CSS shows one of them on phones). */
  const actions = (
    <>
      <span className={s.saved} role="status" aria-live="polite">
        {state.status === "saved" && !pending ? `✓ ${savedLabel(state.savedAt, now ?? new Date())}` : dirty && mode === "edit" && !pending ? <span className={s.unsaved}>Unsaved changes</span> : null}
      </span>
      <ClientButtonLink variant="secondary" href={cancelHref} className={s.btn}>
        Cancel
      </ClientButtonLink>
      <Button type="submit" className={cx(s.btn, s.save)} loading={pending} disabled={disabled || coverBusy}>
        {saveLabel}
      </Button>
    </>
  );

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className={cx(shell.page, s.form)} data-pending={pending ? "" : undefined} aria-busy={pending || undefined} noValidate><CsrfField />
      {eventId ? <input type="hidden" name="id" value={eventId} /> : null}
      <input type="hidden" name="v2" value={JSON.stringify(v2)} />
      <input type="hidden" name="expectedVersion" value={currentVersion} />

      <div className={s.head}>
        <div className={s.headText}>
          <Breadcrumbs items={[{ label: "Events", href: adminLinks.home() }, { label: crumb }]} />
          <h1 className={s.title}>{mode === "new" ? "New event" : "Edit event"}</h1>
        </div>
        <div className={s.actions}>{actions}</div>
      </div>

      <nav ref={navRef} className={s.sectionNav} aria-label="Editor sections" data-more={navMore === null ? "pending" : navMore ? "" : undefined}>
        {SECTIONS.map((sec) => {
          const bad = Object.entries(FIELD_SECTION).some(([f, id]) => id === sec.id && errors[f as EventFormField]) || (sec.id === "details" && FIELD_ORDER.slice(0, 14).some((f) => errors[f]));
          return (
            <a key={sec.id} href={`#${ids}-${sec.id}`} className={s.sectionLink} data-section={sec.id} data-invalid={bad ? "" : undefined} onClick={(e) => e.currentTarget.scrollIntoView?.({ inline: "nearest", block: "nearest" })}>
              {sec.label}
              {bad ? <span className={s.srOnly}> (has errors)</span> : null}
            </a>
          );
        })}
      </nav>

      {errorCount ? (
        <Banner tone="danger" className={s.banner}>
          {fixFieldsMessage(errorCount)}
        </Banner>
      ) : state.status === "error" ? (
        <Banner tone="danger" className={s.banner}>
          {state.message}
        </Banner>
      ) : null}

      <div className={s.grid}>
        <div className={s.main}>
          <section id={`${ids}-details`} tabIndex={-1} className={s.details} aria-labelledby={`${ids}-details-h`}>
            <h2 id={`${ids}-details-h`} className={s.eyebrow}>
              Details
            </h2>
            <div data-field="name">
              <TextField label="Event name" placeholder="e.g. Barcelona Office Opening" maxLength={NAME_MAX + 40} hint={`${values.name.trim().length}/${NAME_MAX}`} {...text("name")} />
            </div>
            <div className={s.row4}>
              <div data-field="date">
                <DatePicker
                  label="Date"
                  name="date"
                  value={toIsoDate(values.date)}
                  onChange={(iso) => set("date", iso)}
                  onBlur={() => blur("date")}
                  min={mode === "new" ? today : undefined}
                  error={errors.date}
                  readOnly={pending}
                />
              </div>
              <div data-field="start">
                <TimeField
                  label="Start"
                  name="start"
                  value={values.start}
                  onChange={(v) => {
                    const next = { ...values, start: v };
                    setValues(next);
                    blur("start", next);
                  }}
                  onBlur={() => blur("start")}
                  error={errors.start}
                  readOnly={pending}
                />
              </div>
              <div data-field="end" className={s.end}>
                <TimeField
                  label="End"
                  name="end"
                  value={values.end}
                  after={normalizeTime(values.start) ?? undefined}
                  durationFrom={normalizeTime(values.start) ?? undefined}
                  afterError={(end) => validateEventField("end", { ...values, end })}
                  onChange={(v) => {
                    const next = { ...values, end: v };
                    setValues(next);
                    blur("end", next);
                  }}
                  onBlur={() => blur("end")}
                  error={errors.end}
                  readOnly={pending}
                />
                {/* Narrow tracks: the duration shows here instead of inside the control (EventForm.module.css). */}
                {duration ? <span className={s.endHint} aria-hidden="true">{duration}</span> : null}
              </div>
              <div data-field="timezone" className={s.tz}>
                <TimezoneField value={values.timezone} date={date} error={errors.timezone} readOnly={pending} onChange={(v) => set("timezone", v)} onBlur={() => blur("timezone")} />
              </div>
            </div>
            <LocationField values={values} errors={errors} placesEnabled={placesEnabled} readOnly={pending} fetcher={placesFetch} onChange={patch} onBlur={(k) => blur(k)} />
            <div className={s.row2}>
              <div data-field="capacity">
                <NumberField label="Capacity" name="capacity" placeholder="150" min={1} max={CAPACITY_MAX} value={values.capacity} onChange={(v) => set("capacity", v)} onBlur={() => blur("capacity")} error={errors.capacity} readOnly={pending} />
              </div>
              <Select
                label="Guest list on the event page"
                value={v2.cover.privacy?.guestList ?? "hidden"}
                disabled={pending}
                onChange={(e) => setV2({ cover: { ...v2.cover, privacy: { guestList: e.target.value as "hidden" | "count" | "names" } } })}
                options={[{ value: "hidden", label: "Hidden" }, { value: "count", label: "Count only" }, { value: "names", label: "Names and count" }]}
              />
            </div>
            <div data-field="description">
              <Textarea
                label={<>Short description{opt(" · for cards and link previews")}</>}
                placeholder="One or two sentences. The full description goes below."
                className={s.description}
                maxLength={DESCRIPTION_MAX + 100}
                hint={`${DESCRIPTION_MAX - values.description.trim().length} characters left`}
                {...text("description")}
              />
            </div>
            <CoverField
              value={v2.cover}
              onChange={(cover) => setV2({ cover: { ...cover, ...(v2.cover.privacy ? { privacy: v2.cover.privacy } : {}) } }, "cover")}
              storedUrl={coverUrl}
              eventId={mode === "edit" ? eventId : undefined}
              editVersion={currentVersion}
              onUploaded={(result) => setCurrentVersion(result.editVersion)}
              defaultAlt={values.name || "Event cover"}
              onBusy={setCoverBusy}
              onPreview={setCoverPreview}
              onStaged={setCoverPending}
              error={errors.cover}
              altError={errors.cover && v2Errors.coverAlt ? v2Errors.coverAlt : undefined}
              readOnly={pending}
              upload={coverUpload}
            />
            <HostsField value={v2.speakers ?? []} onChange={(speakers) => setV2({ speakers })} readOnly={pending} />
          </section>

          <section id={`${ids}-description`} tabIndex={-1} className={s.section} aria-labelledby={`${ids}-description-h`} data-field="descriptionMd">
            <SectionHead id={`${ids}-description-h`} title="Description" help="The full event page text. Guests see it under the event details." />
            <MarkdownEditor
              label="Full description"
              value={v2.descriptionMd}
              onChange={(descriptionMd) => setV2({ descriptionMd }, "descriptionMd")}
              maxLength={DESCRIPTION_MD_MAX}
              placeholder={"## What to expect\n\nDrinks, demos and the team.\n\n- 19:00 Doors\n- 20:00 Welcome"}
              error={errors.descriptionMd}
              readOnly={pending}
              render={render}
            />
          </section>

          <section id={`${ids}-agenda`} tabIndex={-1} className={s.section} aria-labelledby={`${ids}-agenda-h`} data-field="agenda">
            <SectionHead id={`${ids}-agenda-h`} title="Agenda" help="Times are in the event’s time zone. Shown on the event page and in the day-before email." />
            <AgendaField
              value={v2.agenda ?? []}
              onChange={(agenda) => setV2({ agenda }, "agenda")}
              start={values.start}
              end={values.end}
              errors={shownV2("agenda", (k) => k === "agenda" || k.startsWith("agenda:"))}
              readOnly={pending}
            />
          </section>

          <section id={`${ids}-registration`} tabIndex={-1} className={s.section} aria-labelledby={`${ids}-registration-h`} data-field="registration">
            <SectionHead id={`${ids}-registration-h`} title="Registration form" help="How people join and what they answer." />
            {errors.registration && !Object.keys(registrationErrors).length ? <span className={s.error}>{errors.registration}</span> : null}
            <FormBuilder
              value={v2.form}
              onChange={(form) => setV2({ form }, "registration")}
              closesAtLocal={v2.closesAtLocal}
              onClosesAt={(closesAtLocal) => setV2({ closesAtLocal }, "registration")}
              phoneIsCheck={v2.checks.required.includes("phone")}
              errors={registrationErrors}
              readOnly={pending}
              appliesToNew={appliesToNew}
            />
          </section>

          <section id={`${ids}-verification`} tabIndex={-1} className={s.section} aria-labelledby={`${ids}-verification-h`} data-field="verification">
            <SectionHead id={`${ids}-verification-h`} title="Verification" help="What every guest proves before they can ask to join." />
            <VerificationSection value={v2.checks} onChange={(checks) => setV2({ checks }, "verification")} capabilities={capabilities} errors={shownV2("verification", (k) => k === "age")} readOnly={pending} acceptedPolicyCounts={acceptedPolicyCounts} />
          </section>

          <section id={`${ids}-door`} tabIndex={-1} className={s.section} aria-labelledby={`${ids}-door-h`} data-field="door">
            <SectionHead id={`${ids}-door-h`} title="Door" help="How guests are checked in on the day." />
            <DoorSection value={v2.door} onChange={(door) => setV2({ door }, "door")} errors={shownV2("door", (k) => k === "threshold")} readOnly={pending} />
          </section>

          <section id={`${ids}-emails`} tabIndex={-1} className={s.section} aria-labelledby={`${ids}-emails-h`} data-field="emails">
            <SectionHead id={`${ids}-emails-h`} title="Emails" help="What guests receive, and when. Preview each one and send yourself a test." />
            <EmailEditor
              value={v2.emails}
              onChange={(emails) => setV2({ emails }, "emails")}
              eventId={mode === "edit" ? eventId : undefined}
              editVersion={currentVersion}
              templates={emailTemplates}
              transport={emailTransport}
              errors={shownV2("emails", (k) => k.startsWith("email:"))}
              readOnly={pending}
            />
          </section>
        </div>

        <GuestPreview name={preview.name} when={preview.when} where={preview.where} coverUrl={coverPreview ?? (v2.cover.kind === "asset" ? (eventId ? coverSrc(eventId, v2.cover.version) : coverUrl) ?? undefined : undefined)} theme={v2.cover.kind === "theme" ? v2.cover.theme : undefined} />
      </div>

      <div className={s.saveBar} data-dirty={dirty || pending ? "" : undefined}>
        {actions}
      </div>

      <LeaveGuard dirty={dirty} unpublished={mode === "new" || status === "draft"} onSaveDraft={saveDraft} outcome={state} saved={state.status === "saved"} saving={isPending} />
    </form>
  );
}

function SectionHead({ id, title, help }: { id: string; title: string; help: string }) {
  return (
    <div className={s.sectionHead}>
      <h2 id={id} className={s.sectionTitle}>
        {title}
      </h2>
      <span className={s.rowHelp}>{help}</span>
    </div>
  );
}

/** The right-hand guest page preview: follows the inputs as staff type. */
export function GuestPreview({ name, when, where, coverUrl, theme }: { name: string | null; when: string | null; where: string | null; coverUrl?: string; theme?: "aqua" | "sky" }): ReactNode {
  return (
    <aside className={s.preview} aria-label="Guest page preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className={s.cover} data-theme={coverUrl ? undefined : theme}>{coverUrl ? <img src={coverUrl} alt="" className={s.coverImg} decoding="async" /> : "Cover preview"}</div>
      <div className={s.previewBody}>
        <span className={s.previewEyebrow} aria-hidden="true">
          GUEST PAGE PREVIEW
        </span>
        <span className={s.previewName} data-empty={name ? undefined : ""}>
          {name ?? "Event name"}
        </span>
        <span className={s.previewMeta}>
          {when || where ? (
            <>
              {when}
              {when && where ? " " : null}
              {where}
            </>
          ) : (
            "Date · Venue"
          )}
        </span>
      </div>
    </aside>
  );
}
