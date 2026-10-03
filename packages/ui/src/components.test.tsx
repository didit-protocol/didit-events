import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AdminSidebar,
  Avatar,
  avatarInitial,
  Banner,
  Breadcrumbs,
  Button,
  ButtonLink,
  Checkbox,
  ConfirmDialog,
  CopyField,
  DataTable,
  DateTimeField,
  Drawer,
  DropdownMenu,
  EmailField,
  EmailPreview,
  EmptyState,
  EventCover,
  GoogleButton,
  Icon,
  ICON_NAMES,
  Logo,
  MenuPanel,
  Modal,
  PILL_STATUS_KEYS,
  ProgressBar,
  Radio,
  SearchField,
  Segmented,
  Select,
  Skeleton,
  StatTile,
  StatusPill,
  Tabs,
  Textarea,
  TextField,
  Toast,
  Toaster,
  Toggle,
  Tooltip,
  createToastStore,
  initials,
  nextEnabled,
  pageWindow,
  type Column,
  type MenuEntry,
} from "./index";
import { wrapFocus } from "./components/focus";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const noop = () => {};

describe("Button", () => {
  it("maps danger-outline to its own class", () => {
    expect(html(<Button variant="danger-outline">Revoke</Button>)).toMatch(/class="[^"]*dangerOutline/);
  });
  it.each(["primary", "secondary", "ghost", "destructive", "danger-outline"] as const)("%s renders every C-00 state", (variant) => {
    expect(html(<Button variant={variant}>New event</Button>)).toMatch(/^<button type="button"/);
    for (const state of ["hover", "pressed", "focus"] as const) {
      expect(html(<Button variant={variant} state={state}>x</Button>)).toContain(`data-state="${state}"`);
    }
    expect(html(<Button variant={variant} disabled>x</Button>)).toContain("disabled");
    const loading = html(<Button variant={variant} loading>Saving</Button>);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("disabled");
    expect(loading).toContain('aria-hidden="true"'); // spinner
    expect(loading).toContain("Saving");
  });

  it("icon button carries its aria-label and hides content while loading", () => {
    expect(html(<Button variant="icon" aria-label="More actions">⋯</Button>)).toContain('aria-label="More actions"');
    expect(html(<Button variant="icon" aria-label="More" loading>⋯</Button>)).not.toContain("⋯");
  });

  it("sizes and link form", () => {
    expect(html(<Button size="sm">x</Button>)).toMatch(/class="[^"]*sm/);
    expect(html(<Button size="lg">x</Button>)).toMatch(/class="[^"]*lg/);
    expect(html(<ButtonLink href="/admin/new">New</ButtonLink>)).toMatch(/^<a class="[^"]*button[^"]*" href="\/admin\/new"/);
  });
});

describe("text inputs", () => {
  it("TextField wires the label, placeholder and forced focus", () => {
    const out = html(<TextField id="t" label="Name" placeholder="Your name" state="focus" />);
    expect(out).toContain('<label for="t"');
    expect(out).toContain('id="t"');
    expect(out).toContain('data-state="focus"');
  });

  it("EmailField: default / filled / error / disabled", () => {
    expect(html(<EmailField id="e" label="Email" placeholder="you@company.com" />)).toContain('type="email"');
    expect(html(<EmailField id="e" label="Email" defaultValue="maria.garcia@gmail.com" />)).toContain('value="maria.garcia@gmail.com"');
    const err = html(<EmailField id="e" label="Email" error="Enter a valid email address" />);
    expect(err).toContain('aria-invalid="true"');
    expect(err).toContain('aria-describedby="e-error"');
    expect(err).toContain('id="e-error"');
    expect(html(<EmailField id="e" label="Email" disabled />)).toContain("disabled");
  });

  it("hint is described; hidden label stays in the DOM", () => {
    const out = html(<TextField id="h" label="Slug" hideLabel hint="Lowercase letters only" />);
    expect(out).toContain('aria-describedby="h-hint"');
    expect(out).toContain("Slug");
  });

  it("Textarea, Select, DateTime", () => {
    expect(html(<Textarea id="d" label="Description" placeholder="Short description…" />)).toContain("<textarea");
    const sel = html(<Select id="s" label="Time zone" defaultValue="Europe/Madrid" options={[{ value: "Europe/Madrid", label: "Europe/Madrid" }]} />);
    expect(sel).toContain("<select");
    expect(sel).toContain('selected=""');
    const dt = html(<DateTimeField id="dt" label="Starts" name="start" defaultDate="2026-10-23" defaultTime="19:00" error="Pick a date" />);
    expect(dt).toContain('type="date"');
    expect(dt).toContain('type="time"');
    expect(dt).toContain('name="startDate"');
    expect(dt).toContain('aria-label="Time"');
    expect(dt).toContain('aria-invalid="true"');
  });

  it("SearchField shows the clear button only with a value", () => {
    const withValue = html(<SearchField defaultValue="garcía" />);
    expect(withValue).toContain('type="search"');
    expect(withValue).toContain('aria-label="Clear search"');
    expect(html(<SearchField />)).not.toContain("Clear search");
  });
});

describe("choice controls", () => {
  it("Toggle is a switch: off / on / disabled", () => {
    expect(html(<Toggle aria-label="Waitlist" />)).toContain('role="switch"');
    expect(html(<Toggle aria-label="Waitlist" defaultChecked />)).toContain('checked=""');
    expect(html(<Toggle label="Waitlist" disabled />)).toContain("disabled");
  });

  it("Checkbox: unchecked / checked / mixed / disabled", () => {
    expect(html(<Checkbox aria-label="a" />)).toContain('type="checkbox"');
    expect(html(<Checkbox aria-label="a" checked onChange={noop} />)).toContain('checked=""');
    const mixed = html(<Checkbox aria-label="a" checked="mixed" onChange={noop} />);
    expect(mixed).toContain('aria-checked="mixed"');
    expect(mixed).toContain("data-mixed");
    expect(html(<Checkbox label="Accept" disabled />)).toContain("disabled");
  });

  it("Radio and Segmented", () => {
    expect(html(<Radio name="r" aria-label="On" defaultChecked />)).toContain('type="radio"');
    const seg = html(
      <Segmented
        name="t"
        label="Match threshold"
        defaultValue="80"
        options={[
          { value: "70", label: "Relaxed · 70%" },
          { value: "80", label: "Standard · 80%" },
        ]}
      />,
    );
    expect(seg).toContain('role="radiogroup"');
    expect(seg).toContain('aria-label="Match threshold"');
    expect(seg.match(/checked=""/g)).toHaveLength(1);
  });
});

describe("StatusPill", () => {
  it("has all 16 C-00 pills", () => {
    expect(PILL_STATUS_KEYS).toEqual([
      "requested",
      "approved",
      "link-sent",
      "verifying",
      "verified",
      "in-review",
      "declined",
      "rejected",
      "revoked",
      "checked-in",
      "missing",
      "unknown-face",
      "draft",
      "open",
      "live",
      "ended",
    ]);
  });
  it.each(PILL_STATUS_KEYS)("%s renders with a decorative dot", (status) => {
    const out = html(<StatusPill status={status} />);
    expect(out).toContain(`data-status="${status}"`);
    expect(out).toContain('aria-hidden="true"');
  });
});

describe("DataTable", () => {
  interface R {
    id: string;
    name: string;
    email: string;
    bad?: boolean;
    busy?: boolean;
  }
  const columns: Column<R>[] = [
    { key: "name", header: "Name", width: "2fr", sortable: true },
    { key: "email", header: "Email", width: "2fr", secondary: true },
    { key: "status", header: "Status", render: () => "—" },
    { key: "in", header: "Checked in", render: () => "19:42" },
  ];
  const rows: R[] = [
    { id: "a", name: "María García", email: "maria@x.com" },
    { id: "b", name: "James", email: "j@x.com" },
    { id: "c", name: "Aiko", email: "a@x.com", bad: true },
    { id: "d", name: "", email: "", busy: true },
  ];

  it("sortable header, selection, bulk bar, error row, skeleton row, pagination and density", () => {
    const out = html(
      <DataTable
        label="Guests"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        selectedIds={["a", "b"]}
        onSelectionChange={noop}
        bulkActions={[{ id: "approve", label: "Approve", onClick: noop }]}
        sort={{ key: "name", direction: "desc" }}
        onSortChange={noop}
        rowError={(r) => (r.bad ? "Email bounced · Edit email" : undefined)}
        rowLoading={(r) => !!r.busy}
        onDensityChange={noop}
        pagination={{ page: 1, pageSize: 25, total: 124, onPageChange: noop }}
      />,
    );
    expect(out).toContain('role="table"');
    expect(out).toContain('aria-label="Guests"');
    expect(out).toContain('aria-sort="descending"');
    expect(out).toContain("2 selected");
    expect(out).toContain('aria-label="Bulk actions"');
    expect(out).toContain('aria-checked="mixed"'); // header checkbox with 2 of 4
    expect(out.match(/aria-selected="true"/g)).toHaveLength(2);
    expect(out).toContain("data-error");
    expect(out).toContain("Email bounced · Edit email");
    expect(out).toContain('grid-column:span 2');
    expect(out).toContain('role="row" aria-hidden="true"'); // skeleton row
    expect(out).toContain("1–25 of 124");
    expect(out).toContain('aria-current="page"');
    expect(out).toContain('aria-label="Row density"');
  });

  it("loading, empty and compact", () => {
    const loading = html(<DataTable label="G" columns={columns} rows={[]} getRowId={(r) => r.id} loading skeletonRows={4} />);
    expect(loading).toContain('aria-busy="true"');
    expect(loading.match(/role="row" aria-hidden="true"/g)).toHaveLength(4);
    const empty = html(<DataTable label="G" columns={columns} rows={[]} getRowId={(r) => r.id} empty="No guests yet." density="compact" />);
    expect(empty).toContain("No guests yet.");
    expect(empty).toContain('aria-colspan="4"');
    expect(empty).toMatch(/class="[^"]*compact/);
  });

  it("pageWindow keeps five pages around the current one", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(8, 10)).toEqual([6, 7, 8, 9, 10]);
    expect(pageWindow(5, 10)).toEqual([3, 4, 5, 6, 7]);
    expect(pageWindow(1, 2)).toEqual([1, 2]);
  });
});

describe("navigation + display", () => {
  it("Tabs: tablist with roving tabindex, or link nav", () => {
    const items = [
      { id: "overview", label: "Overview" },
      { id: "guests", label: "Guests" },
    ];
    const out = html(<Tabs label="Event" value="overview" items={items} />);
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-selected="true" tabindex="0"');
    expect(out).toContain('aria-selected="false" tabindex="-1"');
    const links = html(<Tabs label="Event" value="guests" items={items.map((i) => ({ ...i, href: `/${i.id}` }))} />);
    expect(links).toContain("<nav");
    expect(links).toContain('aria-current="page"');
  });

  it("Breadcrumbs marks the current page", () => {
    const out = html(<Breadcrumbs items={[{ label: "Events", href: "/admin" }, { label: "Barcelona Office Opening" }]} />);
    expect(out).toContain('aria-label="Breadcrumb"');
    expect(out).toContain('<span aria-current="page">Barcelona Office Opening</span>');
  });

  it("Avatar: initials, tones and sizes", () => {
    expect(initials("María García")).toBe("MG");
    expect(initials("Alberto")).toBe("AL");
    expect(initials("jc@didit.me")).toBe("JC");
    expect(initials("maria.garcia@gmail.com")).toBe("MG");
    const out = html(<Avatar name="Jordi Costa" tone="dark" size={24} />);
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Jordi Costa"');
    expect(out).toContain('<span aria-hidden="true">J</span>');
    expect(out).toContain("font-size:10px");
  });

  it("Avatar fallback: first letter of the first name, else of the email; never an empty circle", () => {
    expect(avatarInitial("maría García", "x@y.z")).toBe("M");
    expect(avatarInitial("", "jordi@didit.me")).toBe("J");
    expect(avatarInitial("   ", " ana@didit.me")).toBe("A");
    expect(avatarInitial("", "")).toBe("");
    expect(avatarInitial("\u00e9lodie", undefined)).toBe("\u00c9");
    expect(avatarInitial("a@b.c", "")).toBe("A");
    // Blank name: the email gives both the letter and the accessible name.
    const blank = html(<Avatar name=" " email="jordi@didit.me" />);
    expect(blank).toContain('<span aria-hidden="true">J</span>');
    expect(blank).toContain('aria-label="jordi@didit.me"');
    // Blank explicit initials are ignored instead of rendering an empty circle.
    expect(html(<Avatar name="" initials="" email="zoe@didit.me" />)).toContain('<span aria-hidden="true">Z</span>');
    // A photo replaces the letter.
    const photo = html(<Avatar name="Ana" src="/api/me/photo?v=1" size={96} />);
    expect(photo).toContain('src="/api/me/photo?v=1"');
    expect(photo).not.toContain('aria-hidden="true">A<');
    expect(photo).toContain("width:96px");
  });

  it("StatTile + ProgressBar", () => {
    expect(html(<StatTile label="Checked in" value="42" delta="+8 in last 15 min" />)).toContain("+8 in last 15 min");
    const bar = html(<ProgressBar label="Checked in" value={62} />);
    expect(bar).toContain('role="progressbar"');
    expect(bar).toContain('aria-valuenow="62"');
    expect(bar).toContain("width:62%");
  });

  it("Banner tones pick status/alert roles", () => {
    expect(html(<Banner>Doors open</Banner>)).toContain('role="status"');
    expect(html(<Banner tone="danger">Didit API is down</Banner>)).toContain('role="alert"');
  });

  it("Tooltip describes its trigger", () => {
    const out = html(
      <Tooltip content="Match threshold 80%">
        <button type="button">i</button>
      </Tooltip>,
    );
    const id = /role="tooltip" id="([^"]+)"/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`aria-describedby="${id}"`);
    expect(html(<Tooltip static content="x"><span /></Tooltip>)).toContain('role="tooltip"');
  });

  it("EmptyState + Skeleton", () => {
    const out = html(<EmptyState title="No events yet." description="Create your first event." action={<Button size="sm">New event</Button>} />);
    expect(out).toContain("<h3");
    expect(out).toContain("New event");
    expect(html(<Skeleton width={64} height={18} shape="pill" shimmer />)).toContain('aria-hidden="true"');
  });
});

describe("feedback", () => {
  it("Toast tones and action", () => {
    expect(html(<Toast message="Link copied" />)).toContain('role="status"');
    expect(html(<Toast tone="danger" message="Couldn't send email" />)).toContain('role="alert"');
    const undo = html(<Toast tone="info" message="Request rejected" action={{ label: "Undo", onClick: noop }} onDismiss={noop} />);
    expect(undo).toContain("Undo");
    expect(undo).toContain('aria-label="Dismiss"');
  });

  it("Toaster renders an empty live list on the server", () => {
    expect(html(<Toaster store={createToastStore()} />)).toContain('aria-label="Notifications"');
  });

  it("toast store: show, cap, auto-dismiss, dismiss", () => {
    vi.useFakeTimers();
    const store = createToastStore();
    const seen: number[] = [];
    const unsub = store.subscribe(() => seen.push(store.getSnapshot().length));
    const id = store.show({ message: "a" });
    store.show({ message: "b", tone: "danger", duration: 0 });
    expect(store.getSnapshot().map((t) => t.tone)).toEqual(["success", "danger"]);
    vi.advanceTimersByTime(4000);
    expect(store.getSnapshot().map((t) => t.message)).toEqual(["b"]);
    store.dismiss(id); // already gone: no emit
    for (let i = 0; i < 6; i++) store.show({ message: String(i), duration: 0 });
    expect(store.getSnapshot()).toHaveLength(4);
    store.clear();
    expect(store.getSnapshot()).toHaveLength(0);
    unsub();
    expect(seen.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });
});

describe("menus + overlays", () => {
  const items: MenuEntry[] = [
    { id: "copy", label: "Copy verification link" },
    { id: "off", label: "Disabled", disabled: true },
    { id: "sep", type: "separator" },
    { id: "revoke", label: "Revoke invite", danger: true },
  ];

  it("MenuPanel: menu roles, highlighted item, separator, disabled", () => {
    const out = html(<MenuPanel label="Guest actions" items={items} highlighted={0} />);
    expect(out).toContain('role="menu"');
    expect(out.match(/role="menuitem"/g)).toHaveLength(3);
    expect(out).toContain('role="separator"');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain("data-highlighted");
  });

  it("DropdownMenu trigger advertises the popup (closed on the server)", () => {
    const out = html(<DropdownMenu trigger="Actions" items={items} />);
    expect(out).toContain('aria-haspopup="menu"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('role="menu"');
  });

  it("nextEnabled skips separators and disabled items, wrapping", () => {
    expect(nextEnabled(items, -1, 1)).toBe(0);
    expect(nextEnabled(items, 0, 1)).toBe(3);
    expect(nextEnabled(items, 3, 1)).toBe(0);
    expect(nextEnabled(items, 0, -1)).toBe(3);
  });

  it("Modal / ConfirmDialog / Drawer inline render dialog semantics", () => {
    const modal = html(<Modal inline open onClose={noop} title="Session expired" description="Sign in again." footer={<Button>Sign in</Button>} />);
    expect(modal).toContain('role="dialog"');
    expect(modal).toMatch(/aria-labelledby="[^"]+"/);
    expect(modal).toMatch(/aria-describedby="[^"]+"/);
    const confirm = html(<ConfirmDialog inline open onClose={noop} onConfirm={noop} destructive title="Revoke invite?" confirmLabel="Revoke" />);
    expect(confirm).toContain('role="alertdialog"');
    expect(confirm).toContain("data-autofocus");
    expect(confirm).toContain("Revoke");
    const drawer = html(<Drawer inline open onClose={noop} title="María García">Details</Drawer>);
    expect(drawer).toContain('role="dialog"');
    expect(drawer).toContain('aria-label="Close"');
    expect(html(<Modal open={false} onClose={noop} title="x" />)).toBe("");
    // Portal overlays render nothing on the server (they mount on the client).
    expect(html(<Modal open onClose={noop} title="x" />)).toBe("");
  });

  it("Modal closeLabel adds a close button beside the title", () => {
    const modal = html(<Modal inline open onClose={noop} title="Add guests" closeLabel="Close" />);
    expect(modal).toContain('aria-label="Close"');
    expect(modal.indexOf("Add guests")).toBeLessThan(modal.indexOf('aria-label="Close"'));
    expect(html(<Modal inline open onClose={noop} title="x" />)).not.toContain('aria-label="Close"');
  });

  it("Drawer stacked header: eyebrow row with close, title (labels the dialog) with aside, subtitle", () => {
    const drawer = html(
      <Drawer inline open onClose={noop} eyebrow="Guest" title="María García" titleAside={<StatusPill status="verified" />} subtitle="maria.garcia@gmail.com">
        Details
      </Drawer>,
    );
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(drawer)?.[1];
    expect(drawer).toContain(`id="${labelledBy}"`);
    expect(drawer).toMatch(/<h2 id="[^"]+"[^>]*>María García<\/h2>/);
    expect(drawer.indexOf("Guest")).toBeLessThan(drawer.indexOf('aria-label="Close"'));
    expect(drawer).toContain("maria.garcia@gmail.com");
    expect(drawer).toContain('data-status="verified"');
  });

  it("wrapFocus cycles at both ends", () => {
    const a = { id: "a" } as unknown as HTMLElement;
    const b = { id: "b" } as unknown as HTMLElement;
    expect(wrapFocus([a, b], b, false)).toBe(a);
    expect(wrapFocus([a, b], a, true)).toBe(b);
    expect(wrapFocus([a, b], a, false)).toBeNull();
    expect(wrapFocus([a, b], null, false)).toBe(a);
    expect(wrapFocus([], null, false)).toBeNull();
  });

  it("CopyField: default and copied", () => {
    const def = html(<CopyField label="Verification link" value="https://verify.didit.me/s/x" display="verify.didit.me/s/x" />);
    expect(def).toContain('role="group"');
    expect(def).toContain('aria-live="polite"');
    expect(def).toContain(">Copy<");
    expect(html(<CopyField label="L" value="v" copied />)).toContain("✓ Copied");
  });
});

describe("brand pieces", () => {
  it("Logo variants", () => {
    for (const variant of ["color", "white", "mark", "white-gradient"] as const) {
      const out = html(<Logo variant={variant} height={22} />);
      expect(out).toContain('alt="Didit"');
      expect(out).toContain('height="22"');
    }
    expect(html(<Logo variant="color" width={140} />)).toContain('height="48"');
  });

  it("GoogleButton default, loading, link", () => {
    expect(html(<GoogleButton />)).toContain("Continue with Google");
    const loading = html(<GoogleButton loading />);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Signing in…");
    expect(html(<GoogleButton href="/api/auth/google" />)).toMatch(/^<a [^>]*href="\/api\/auth\/google"/);
  });

  it("AdminSidebar marks the active section", () => {
    const out = html(<AdminSidebar active="team" user={{ name: "Alberto", email: "events.team@didit.me" }} />);
    expect(out).toContain('aria-label="Admin"');
    expect(out).toMatch(/<a(?=[^>]*href="\/admin\/team")(?=[^>]*aria-current="page")/);
    expect(out).not.toContain("/admin/kiosks");
    // People (every account) is owner-only: hidden unless the app lists it.
    expect(out).not.toContain("/admin/people");
    const owner = html(<AdminSidebar active="people" sections={["events", "team", "calendar", "people"]} user={{ name: "Alberto", email: "events.team@didit.me" }} />);
    expect(owner).toMatch(/<a(?=[^>]*href="\/admin\/people")(?=[^>]*aria-current="page")/);
    // Event team members only get the Events section.
    const member = html(<AdminSidebar active="events" sections={["events"]} user={{ name: "Ops", email: "ops@example.com" }} />);
    expect(member).toContain('href="/admin"');
    expect(member).not.toContain("/admin/team");
    expect(member).not.toContain("/admin/calendar");
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toContain('<span aria-hidden="true">A</span>');
    expect(out).toContain("Sign out");
  });

  it.each([
    ["square", "sky", 1080, 1080],
    ["og", "aqua", 1200, 630],
    ["story", "sky", 1080, 1920],
  ] as const)("EventCover %s/%s is %i×%i", (format, theme, w, h) => {
    const out = html(<EventCover format={format} theme={theme} title="Building in the" accent="AI Era" date="Thu 8 Oct 2026" />);
    expect(out).toContain(`width:${w}px;height:${h}px`);
    expect(out).toContain('role="img"');
    expect(out).toContain("AI Era");
    expect(out).toContain("Thu 8 Oct 2026");
    if (theme === "aqua") expect(out).toContain("scaleX(-1)");
  });

  it("Icon: decorative by default, labelled when asked", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(20);
    expect(html(<Icon name="search" />)).toContain('aria-hidden="true"');
    expect(html(<Icon name="search" label="Search" />)).toContain('role="img"');
  });
});

describe("review fixes", () => {
  it("ButtonLink shows a spinner and aria-busy when loading", () => {
    const out = html(<ButtonLink href="/x" loading>Save</ButtonLink>);
    expect(out).toContain('aria-busy="true"');
    expect(out).toMatch(/spinner|Spinner|role="status"|<svg/i);
  });
  it("DataTable error rows keep exactly one cell per column even with errorSpan=0", () => {
    const cols = [{ key: "a", header: "A" }, { key: "b", header: "B" }, { key: "c", header: "C" }];
    const out = html(<DataTable label="Test" columns={cols as never} rows={[{ id: "1", a: 1, b: 2, c: 3 }] as never} getRowId={(r: { id: string }) => r.id} rowError={() => "Bounced"} errorSpan={0} />);
    expect(out).not.toContain("span 0");
    expect(out).toContain("span 1");
  });
});

describe("EmailPreview", () => {
  const doc = "<!DOCTYPE html><html><body><p>Hello & welcome</p></body></html>";
  it("renders the inbox header and the email in a sandboxed, titled iframe", () => {
    const out = html(
      <EmailPreview label="M-02 Request received" from={{ name: "Didit Events", address: "events.owner@didit.me" }} trigger="R-08 request submitted" subject="We got your request" preheader="You will hear back by Fri 2 Oct." html={doc} />,
    );
    expect(out).toContain('data-screen-label="M-02 Request received"');
    expect(out).toContain("<b");
    expect(out).toContain("Didit Events</b> &lt;events.owner@didit.me&gt;");
    expect(out).toContain(" · trigger: R-08 request submitted");
    expect(out).toContain('title="Email preview: We got your request"');
    expect(out).toMatch(/sandbox="allow-same-origin[^"]*"/);
    expect(out).not.toMatch(/sandbox="[^"]*allow-scripts/);
    expect(out).toMatch(/srcdoc="&lt;!DOCTYPE html&gt;.*Hello &amp; welcome/i);
    expect(out).toContain("desktop");
  });
  it("mobile size drops the trigger when absent", () => {
    const out = html(<EmailPreview size="mobile" from={{ name: "Didit Events", address: "events.owner@didit.me" }} subject="S" preheader="P" html={doc} />);
    expect(out).toContain("mobile");
    expect(out).not.toContain("trigger:");
    expect(out).not.toContain("data-screen-label");
  });
});
