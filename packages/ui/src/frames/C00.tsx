"use client";

import type { CSSProperties } from "react";
import { Button, type ButtonVariant, type ForcedState } from "../components/Button";
import { Checkbox } from "../components/Checkbox";
import { CopyField } from "../components/CopyField";
import { DataTable, type Column } from "../components/DataTable";
import { Breadcrumbs } from "../components/ClientLink";
import { Avatar, Banner, EmptyState, ProgressBar, Skeleton, StatTile, Tooltip } from "../components/Display";
import { MenuPanel } from "../components/DropdownMenu";
import { DateTimeField, EmailField, Radio, Segmented, Select, Textarea, Toggle } from "../components/Field";
import { ConfirmDialog } from "../components/Overlay";
import { Combobox } from "../components/Combobox";
import { DatePicker } from "../components/DatePicker";
import DatePickerCalendar from "../components/DatePickerCalendar";
import { NumberField } from "../components/NumberField";
import { TimeField } from "../components/TimeField";
import { SearchField } from "../components/SearchField";
import { PILL_STATUS_KEYS, StatusPill } from "../components/StatusPill";
import { Tabs } from "../components/Tabs";
import { Toast } from "../components/Toast";
import styles from "./frame.module.css";

const noop = () => {};

const STATES = ["Default", "Hover", "Pressed", "Focus", "Disabled", "Loading"] as const;
const ROWS: Array<{ name: string; variant: ButtonVariant; label: string }> = [
  { name: "Primary", variant: "primary", label: "New event" },
  { name: "Secondary", variant: "secondary", label: "Export CSV" },
  { name: "Ghost", variant: "ghost", label: "Export CSV" },
  { name: "Destructive", variant: "destructive", label: "Revoke" },
  { name: "Icon button", variant: "icon", label: "⋯" },
];
const FORCED: Partial<Record<(typeof STATES)[number], ForcedState>> = { Hover: "hover", Pressed: "pressed", Focus: "focus" };

interface Guest {
  id: string;
  name: string;
  email: string;
  status?: "verified" | "link-sent";
  checkedIn?: string;
  loading?: boolean;
  error?: string;
}
const GUESTS: Guest[] = [
  { id: "g1", name: "María García", email: "maria.garcia@gmail.com", status: "verified", checkedIn: "19:42" },
  { id: "g2", name: "James Whitfield", email: "james@whitfield.test", status: "link-sent" },
  { id: "g3", name: "", email: "", loading: true },
  { id: "g4", name: "Aiko Tanaka", email: "aiko.tanaka@exmaple.jp", error: "Email bounced · Edit email" },
];
const COLUMNS: Column<Guest>[] = [
  { key: "name", header: "Name", width: "2fr", sortable: true, skeleton: { width: "60%" } },
  { key: "email", header: "Email", width: "2fr", secondary: true, skeleton: { width: "70%" } },
  { key: "status", header: "Status", width: "1fr", render: (g) => (g.status ? <StatusPill status={g.status} /> : null), skeleton: { shape: "pill" } },
  {
    key: "checkedIn",
    header: "Checked in",
    width: "1fr",
    tnum: true,
    render: (g) => g.checkedIn ?? <span style={{ color: "var(--warning-fg)" }}>Missing</span>,
    skeleton: { width: "40%" },
  },
];

const label: CSSProperties = { font: "500 13px/normal var(--font-sans)" };

export function C00Components() {
  return (
    <div data-screen-label="C-00 Components" className={styles.frame}>
      <div className={styles.head}>
        <div className={styles.kicker}>C-00 · Components</div>
        <div className={styles.title}>
          Shared parts. <span style={{ color: "var(--brand)" }}>Every state.</span>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.eyebrow}>Buttons</div>
        <div style={{ display: "grid", gridTemplateColumns: "120px repeat(6,1fr)", gap: "12px 16px", alignItems: "center" }}>
          <span />
          {STATES.map((s) => (
            <span key={s} className={styles.eyebrow}>
              {s}
            </span>
          ))}
          {ROWS.map((row) => [
            <span key={row.name} style={label}>
              {row.name}
            </span>,
            ...STATES.map((s) => (
              <div key={`${row.name}-${s}`}>
                <Button
                  variant={row.variant}
                  state={FORCED[s]}
                  disabled={s === "Disabled"}
                  loading={s === "Loading"}
                  aria-label={row.variant === "icon" ? "More actions" : undefined}
                >
                  {s === "Loading" && row.variant !== "icon" ? "Saving" : row.label}
                </Button>
              </div>
            )),
          ])}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.eyebrow}>Inputs</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 24 }}>
          {(
            [
              ["Default", { placeholder: "you@company.com" }],
              ["Focus", { defaultValue: "maria@", state: "focus" }],
              ["Filled", { defaultValue: "maria.garcia@gmail.com" }],
              ["Error", { defaultValue: "maria.garcia@gmail", error: "Enter a valid email address" }],
              ["Disabled", { defaultValue: "maria.garcia@gmail.com", disabled: true }],
            ] as const
          ).map(([state, props]) => (
            <div key={state} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className={styles.eyebrow}>{state}</span>
              <EmailField label="Email" name={`email-${state}`} {...props} />
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 24, marginTop: 8 }}>
          <SearchField label="Search" showLabel defaultValue="garcía" />
          <Select label="Select" defaultValue="Europe/Madrid" options={[{ value: "Europe/Madrid", label: "Europe/Madrid" }, { value: "Europe/London", label: "Europe/London" }]} />
          <DateTimeField label="Date and time" defaultDate="2026-10-23" defaultTime="19:00" />
          <Textarea label="Textarea" placeholder="Short description…" />
        </div>
        <div className={styles.eyebrow} style={{ marginTop: 16 }}>
          Pickers · date (popover grid loads on open), time (15-min slots + typed entry), stepper, combobox
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 24, alignItems: "start" }}>
          <DatePicker label="Date" value="" onChange={noop} />
          <DatePicker label="Date · filled" value="2026-10-23" onChange={noop} />
          <DatePicker label="Date · error" value="" onChange={noop} error="Pick a date" />
          <DatePicker label="Date · disabled" value="2026-10-23" onChange={noop} disabled />
          <TimeField label="Start" value="19:00" onChange={noop} />
          <TimeField label="End" value="22:30" after="19:00" durationFrom="19:00" onChange={noop} />
          <NumberField label="Capacity" value="1200" onChange={noop} min={1} max={10000} />
          <Combobox label="Timezone" inputValue="Europe/Madrid (CEST)" onInputChange={noop} options={[]} onSelect={noop} listLabel="Timezones" trailing="UTC+02:00" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 24, alignItems: "start", marginTop: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, height: 360 }}>
            <span className={styles.caption}>Date popover (Oct 2026, today 30 Sep, 23 selected, before min disabled)</span>
            <div style={{ position: "relative", height: 0 }}>
            <DatePickerCalendar id="c00-cal" label="Choose date" value="2026-10-23" min="2026-10-05" onSelect={noop} onClose={noop} today={{ y: 2026, m: 9, d: 30 }} autoFocus={false} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 40, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <div className={styles.row}>
            <Toggle aria-label="Toggle off" />
            <Toggle aria-label="Toggle on" defaultChecked />
            <Toggle aria-label="Toggle disabled" defaultChecked disabled />
            <span className={styles.caption}>Toggle off · on · disabled</span>
          </div>
          <div className={styles.row}>
            <Checkbox aria-label="Unchecked" />
            <Checkbox aria-label="Checked" checked onChange={noop} />
            <Checkbox aria-label="Mixed" checked="mixed" onChange={noop} />
            <Checkbox aria-label="Disabled" disabled />
            <span className={styles.caption}>Checkbox · checked · mixed · disabled</span>
          </div>
          <div className={styles.row}>
            <Radio name="c00-radio" aria-label="Off" />
            <Radio name="c00-radio" aria-label="On" defaultChecked />
            <span className={styles.caption}>Radio</span>
          </div>
          <Segmented
            name="c00-threshold"
            label="Match threshold"
            defaultValue="80"
            options={[
              { value: "70", label: "Relaxed · 70%" },
              { value: "80", label: "Standard · 80%" },
              { value: "90", label: "Strict · 90%" },
            ]}
          />
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.eyebrow}>Status pills</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {PILL_STATUS_KEYS.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.eyebrow}>Data table · sticky header · sort · hover · selected · bulk bar · skeleton · error row</div>
        <DataTable
          label="Guests"
          columns={COLUMNS}
          rows={GUESTS}
          getRowId={(g) => g.id}
          selectedIds={["g1", "g2"]}
          onSelectionChange={noop}
          bulkActions={["Approve", "Send links", "Revoke", "Export"].map((l) => ({ id: l, label: l, onClick: noop }))}
          sort={{ key: "name", direction: "desc" }}
          onSortChange={noop}
          rowStates={{ g2: "hover" }}
          rowLoading={(g) => !!g.loading}
          rowError={(g) => g.error}
          onDensityChange={noop}
          pagination={{ page: 1, pageSize: 25, total: 124, onPageChange: noop }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 32 }}>
        <div className={styles.section}>
          <div className={styles.eyebrow}>Tabs · breadcrumbs · avatar</div>
          <Tabs
            label="Event sections"
            value="overview"
            onChange={noop}
            items={[
              { id: "overview", label: "Overview" },
              { id: "guests", label: "Guests" },
              { id: "requests", label: "Requests" },
            ]}
          />
          <Breadcrumbs items={[{ label: "Events", href: "#" }, { label: "Barcelona Office Opening" }]} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Avatar name="María García" />
            <Avatar name="Ana Sánchez" tone="brand" />
            <Avatar name="Jordi Costa" tone="dark" size={24} />
          </div>
        </div>
        <div className={styles.section}>
          <div className={styles.eyebrow}>Stat tile · progress</div>
          <StatTile label="Checked in" value="42" delta="+8 in last 15 min" />
          <ProgressBar label="Checked in" value={62} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className={styles.eyebrow}>Toasts · banner · tooltip</div>
          <Toast tone="success" message="Link copied" />
          <Toast tone="danger" message="Couldn't send email. Retry" />
          <Toast tone="info" message="Request rejected" action={{ label: "Undo", onClick: noop }} />
          <Banner>Doors open in 2h 14m. Kiosk is paired and ready.</Banner>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Tooltip static content="Match threshold 80%">
              <span />
            </Tooltip>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr", gap: 32, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className={styles.eyebrow}>Dropdown menu</div>
          <MenuPanel
            label="Guest actions"
            highlighted={0}
            items={[
              { id: "copy", label: "Copy verification link" },
              { id: "send", label: "Send link by email" },
              { id: "resend", label: "Resend link" },
              { id: "didit", label: "View in Didit ↗" },
              { id: "sep", type: "separator" },
              { id: "manual", label: "Manual check-in" },
              { id: "revoke", label: "Revoke invite", danger: true },
            ]}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className={styles.eyebrow}>Copy-to-clipboard field</div>
          <CopyField label="Verification link" value="https://verify.didit.me/s/7Hk2Qm" display="verify.didit.me/s/7Hk2…Qm" copied={false} />
          <CopyField label="Verification link" value="https://verify.didit.me/s/7Hk2Qm" display="verify.didit.me/s/7Hk2…Qm" copied />
          <div className={styles.eyebrow} style={{ marginTop: 12 }}>
            Empty state
          </div>
          <EmptyState
            title="No events yet."
            description="Create your first event to start inviting guests."
            action={
              <Button size="sm" variant="primary">
                New event
              </Button>
            }
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className={styles.eyebrow}>Modal · confirm · drawer</div>
          <div style={{ background: "var(--overlay)", borderRadius: 12, padding: 24, display: "flex", gap: 16, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <ConfirmDialog
                inline
                open
                onClose={noop}
                onConfirm={noop}
                destructive
                title="Revoke invite?"
                description="María's link stops working and the kiosk won't recognise her."
                confirmLabel="Revoke"
              />
            </div>
            <div
              aria-hidden="true"
              style={{ width: 120, alignSelf: "stretch", background: "#FEFEFE", borderRadius: "12px 0 0 12px", padding: 12, display: "flex", flexDirection: "column", gap: 8, boxSizing: "border-box" }}
            >
              <span style={{ font: "500 11px/normal var(--font-sans)", letterSpacing: ".08em", color: "#6E6E73" }}>DRAWER 480</span>
              <Skeleton width="80%" height={8} />
              <Skeleton width="60%" height={8} />
              <Skeleton width="70%" height={8} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
