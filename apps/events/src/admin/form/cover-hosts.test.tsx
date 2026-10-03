// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventForm } from "./EventForm";
import { shapeNote, type CoverUpload } from "./CoverField";
import { hostAvatarSrc } from "./HostsField";
import { BCN_FORM, EMPTY_EVENT } from "./fixtures";
import type { EventFormState, EventFormValues } from "./types";
import type { EditorV2 } from "./editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = "3f0a6c1e-8b1d-4c1a-9d5e-2a7b6c5d4e3f";
const V1 = "00000000-0000-4000-8000-0000000000a1", V2 = "00000000-0000-4000-8000-0000000000b2", W1 = "00000000-0000-4000-8000-0000000000c3";

let host: HTMLDivElement;
let root: Root;
let objectUrls = 0;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  objectUrls = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:picked-${++objectUrls}`, revokeObjectURL: () => {} }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, data: [] })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (el: ReactElement) => act(() => root.render(el));
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const type = (input: HTMLInputElement, value: string) => act(() => { setValue.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };
const v2 = (): EditorV2 => JSON.parse(new FormData(host.querySelector("form")!).get("v2") as string);
const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent === label)!;
const slot = (v: "main" | "wide") => host.querySelector<HTMLElement>(`[data-cover-slot="${v}"]`)!;
const fileInput = (v: "main" | "wide") => slot(v).querySelector<HTMLInputElement>('input[type="file"]')!;
const pick = async (v: "main" | "wide", file: File) => {
  const input = fileInput(v);
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
};
const png = (name = "photo.png") => new File([new Uint8Array(2048)], name, { type: "image/png" });

function editForm(values: EventFormValues, upload: CoverUpload, action = vi.fn(async (_p: EventFormState, _f: FormData): Promise<EventFormState> => ({ status: "idle", values }))) {
  render(<EventForm mode="edit" crumb="BCN" cancelHref="/admin" eventId={EVENT} editVersion={4} action={action} initialState={{ status: "idle", values }} coverUpload={upload} />);
  return action;
}

const withV2 = (p: Partial<EditorV2>): EventFormValues => ({ ...BCN_FORM, v2: { ...BCN_FORM.v2!, ...p } });

describe("Hosts", () => {
  it("one aligned row per host: avatar, Name, Role, Account email and row tools, in that order", () => {
    editForm(withV2({ speakers: [{ name: "Alberto Rosas", role: "CEO", email: "events.team@didit.me" }, { name: "Uma", role: "Didit" }] }), vi.fn());
    const rows = [...host.querySelectorAll<HTMLElement>("[data-host-row]")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const cells = [...row.children];
      expect(cells).toHaveLength(5);
      expect(cells[0]!.querySelector('[role="img"]')).toBeTruthy();
      expect([1, 2, 3].map((i) => cells[i]!.querySelector("label")!.textContent)).toEqual(["Name", "Role", "Account email · optional"]);
      // Same input component for every field, no per-field hint that would make one cell taller.
      expect(row.querySelectorAll("input:not([type=file])")).toHaveLength(3);
      expect(cells[4]!.querySelectorAll("button")).toHaveLength(3);
    }
    expect((rows[0]!.querySelectorAll("input")[2] as HTMLInputElement).value).toBe("events.team@didit.me");
    // The saved account email probes its photo (staff route); the host without an email keeps initials only.
    expect(rows[0]!.querySelector("img[hidden]")!.getAttribute("src")).toBe("/api/admin/hosts/photo?email=events.team%40didit.me");
    expect(rows[1]!.querySelector("img")).toBeNull();
  });

  it("the avatar switches to the account photo only once it loads; a 404 keeps the initials", () => {
    editForm(withV2({ speakers: [{ name: "Alberto Rosas", role: "CEO", email: "events.team@didit.me" }, { name: "Guest", role: "", email: "nophoto@example.test" }] }), vi.fn());
    const [a, b] = [...host.querySelectorAll<HTMLElement>("[data-host-row]")];
    act(() => { a!.querySelector("img[hidden]")!.dispatchEvent(new Event("load")); });
    act(() => { b!.querySelector("img[hidden]")!.dispatchEvent(new Event("error")); });
    expect(a!.querySelector("[data-photo] img:not([hidden])")!.getAttribute("src")).toBe("/api/admin/hosts/photo?email=events.team%40didit.me");
    expect(b!.querySelector("img")).toBeNull();
    expect(b!.textContent).toContain("G");
  });

  it("add, edit, reorder and remove hosts; the posted speakers follow", () => {
    editForm(withV2({ speakers: [{ name: "Alberto Rosas", role: "CEO" }] }), vi.fn());
    act(() => button("Add host").click());
    const second = host.querySelectorAll<HTMLElement>("[data-host-row]")[1]!;
    type(second.querySelectorAll("input")[0] as HTMLInputElement, "Uma");
    type(second.querySelectorAll("input")[1] as HTMLInputElement, "Didit");
    type(second.querySelectorAll("input")[2] as HTMLInputElement, " Uma@Didit.me ");
    expect(v2().speakers).toEqual([{ name: "Alberto Rosas", role: "CEO" }, { name: "Uma", role: "Didit", email: "uma@didit.me" }]);
    expect(button("Move Alberto Rosas up").disabled).toBe(true);
    expect(button("Move Uma down").disabled).toBe(true);
    act(() => button("Move Uma up").click());
    expect(v2().speakers!.map((h) => h.name)).toEqual(["Uma", "Alberto Rosas"]);
    // Inputs stay with their host after the move.
    expect((host.querySelectorAll<HTMLElement>("[data-host-row]")[0]!.querySelector("input") as HTMLInputElement).value).toBe("Uma");
    act(() => button("Remove Alberto Rosas").click());
    expect(v2().speakers).toEqual([{ name: "Uma", role: "Didit", email: "uma@didit.me" }]);
    expect(hostAvatarSrc("uma@")).toBeUndefined();
    expect(hostAvatarSrc("Uma@Didit.me")).toBe("/api/admin/hosts/photo?email=uma%40didit.me");
  });
});

describe("Cover slots", () => {
  const ok = (version: string, editVersion: number, w = 1200, h = 1200) => ({ ok: true as const, data: { version, url: `/api/events/${EVENT}/cover?v=${version}`, width: w, height: h, contentType: "image/webp" as const, editVersion } });

  it("edit: square and banner previews at their real shapes, current stored images shown from versioned URLs", () => {
    editForm(withV2({ cover: { kind: "asset", version: V1, alt: "Terrace", wide: { version: W1 } } }), vi.fn());
    expect(slot("main").textContent).toContain("Square cover");
    expect(slot("main").textContent).toContain("1:1 · event page and cards");
    expect(slot("wide").textContent).toContain("Banner");
    expect(slot("wide").textContent).toContain("about 10:3 · tickets and emails");
    expect(slot("main").querySelector("img")!.getAttribute("src")).toBe(`/api/events/${EVENT}/cover?v=${V1}`);
    expect(slot("main").querySelector("img")!.getAttribute("alt")).toBe("Terrace");
    expect(slot("wide").querySelector("img")!.getAttribute("src")).toBe(`/api/events/${EVENT}/cover?v=${W1}`);
    expect(fileInput("main").name).toBe("cover");
    expect(fileInput("wide").name).toBe("coverWide");
  });

  it("edit: upload the square cover, then the banner (chained edit versions), replace, then remove the banner", async () => {
    const calls: [string, number, string | undefined][] = [];
    const versions = [ok(V1, 5), ok(W1, 6, 1500, 450), ok(V2, 7)];
    const upload: CoverUpload = vi.fn(async (_id, _f, editVersion, onProgress, o) => { onProgress(50); calls.push([o!.variant, editVersion, o!.alt]); return versions.shift()!; });
    editForm(withV2({}), upload);
    expect(v2().cover).toEqual({ kind: "theme", theme: "aqua" });

    await pick("main", png("square.png"));
    expect(v2().cover).toEqual({ kind: "asset", version: V1, alt: "Barcelona Office Opening" });
    expect(slot("main").textContent).toContain("Uploaded · 1200×1200");
    expect(slot("main").querySelector("img")!.getAttribute("src")).toBe("blob:picked-1");

    await pick("wide", png("banner.png"));
    expect(v2().cover).toEqual({ kind: "asset", version: V1, alt: "Barcelona Office Opening", wide: { version: W1 } });
    expect(new FormData(host.querySelector("form")!).get("expectedVersion")).toBe("6");

    // Replace the square cover: the banner pointer survives.
    await pick("main", png("square-2.png"));
    expect(v2().cover).toEqual({ kind: "asset", version: V2, alt: "Barcelona Office Opening", wide: { version: W1 } });
    expect(calls).toEqual([["main", 4, "Barcelona Office Opening"], ["wide", 5, "Barcelona Office Opening"], ["main", 6, "Barcelona Office Opening"]]);

    act(() => button("Remove banner").click());
    expect(v2().cover).toEqual({ kind: "asset", version: V2, alt: "Barcelona Office Opening" });
    expect(slot("wide").querySelector("img")).toBeNull();
    expect(host.textContent).toContain("Unsaved changes");
  });

  it("edit: removing the square cover falls back to a theme and keeps the banner", () => {
    editForm(withV2({ cover: { kind: "asset", version: V1, alt: "Terrace", privacy: { guestList: "count" }, wide: { version: W1 } } }), vi.fn());
    act(() => button("Remove square").click());
    expect(v2().cover).toEqual({ kind: "theme", theme: "aqua", privacy: { guestList: "count" }, wide: { version: W1 } });
    expect(slot("main").querySelector("img")).toBeNull();
    expect(slot("main").querySelector("[data-theme='aqua']")).toBeTruthy();
    expect(slot("wide").querySelector("img")).toBeTruthy();
  });

  it("edit: a failed upload shows the message under that slot and keeps the stored image", async () => {
    const upload: CoverUpload = vi.fn(async () => ({ ok: false as const, code: "invalid" as const, message: "That image couldn’t be used." }));
    editForm(withV2({ cover: { kind: "asset", version: V1, alt: "Terrace" } }), upload);
    await pick("wide", png());
    expect(slot("wide").querySelector('[role="alert"]')!.textContent).toBe("That image couldn’t be used.");
    expect(slot("wide").querySelector("img")).toBeNull();
    expect(v2().cover).toEqual({ kind: "asset", version: V1, alt: "Terrace" });
  });

  it("validation: a non-image is refused in the browser before any upload", async () => {
    const upload = vi.fn() as unknown as CoverUpload;
    editForm(withV2({}), upload);
    await pick("main", new File(["%PDF"], "brief.pdf", { type: "application/pdf" }));
    expect(slot("main").querySelector('[role="alert"]')!.textContent).toBe("Use a JPG or PNG");
    expect(upload).not.toHaveBeenCalled();
  });

  it("new event: both images are staged with the form (no upload before the event exists) and arm Create event", async () => {
    const upload = vi.fn() as unknown as CoverUpload;
    render(<EventForm mode="new" crumb="New event" cancelHref="/admin" action={vi.fn()} initialState={{ status: "idle", values: EMPTY_EVENT }} coverUpload={upload} />);
    const create = button("Create event");
    expect(create.disabled).toBe(true);
    await pick("main", png("square.png"));
    await pick("wide", png("banner.png"));
    expect(upload).not.toHaveBeenCalled();
    expect(slot("main").textContent).toContain("Uploads when you create the event.");
    expect(slot("wide").textContent).toContain("Uploads when you create the event.");
    expect(slot("main").querySelector("img")!.getAttribute("src")).toBe("blob:picked-1");
    expect(slot("wide").querySelector("img")!.getAttribute("src")).toBe("blob:picked-2");
    expect([fileInput("main").name, fileInput("wide").name]).toEqual(["cover", "coverWide"]);
    // The staged square cover's alt text goes with the save.
    expect(host.querySelector<HTMLInputElement>('input[name="coverAlt"]')).toBeTruthy();
    expect(button("Create event").disabled).toBe(false);
    // The guest page preview shows the staged square cover.
    expect(host.querySelector("[aria-label='Guest page preview'] img")!.getAttribute("src")).toBe("blob:picked-1");
  });

  it("shape notes: far-off shapes are flagged, close ones are not", () => {
    expect(shapeNote("main", 1080, 1080)).toBeNull();
    expect(shapeNote("main", 1600, 900)).toContain("Not square");
    expect(shapeNote("wide", 1500, 450)).toBeNull();
    expect(shapeNote("wide", 1200, 630)).toContain("Not a banner shape");
  });
});
