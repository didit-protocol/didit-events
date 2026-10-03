// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CsrfProvider } from "../auth/CsrfField";
import { SettingsScreen } from "./components/SettingsScreen";
import { PhotoUploader, type PhotoUploadAction } from "./components/PhotoUploader";
import { EditProfileForm, type EditProfileAction } from "./components/EditProfileForm";
import { initialsOf } from "./components/StatusScreen";
import { MyEventsScreen } from "./components/MyEvents";
import { readFileSync } from "node:fs";
import { FIXED_NOW, MARIA, MARIA_NEW } from "./fixtures";
import type { GuestAccount } from "./types";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("../admin/useAdminRouter", () => ({ useAdminRouter: () => router }));
vi.mock("../../app/me/settings/actions", () => ({ signOutAction: vi.fn(async () => {}) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let urls = 0;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  router.refresh.mockClear();
  URL.createObjectURL = vi.fn(() => `blob:preview-${++urls}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (el: ReactElement) => act(() => root.render(<CsrfProvider token="csrf-token">{el}</CsrfProvider>));
const button = (label: RegExp) => Array.from(host.querySelectorAll("button")).find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
const choose = (file: File) =>
  act(async () => {
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const noop: PhotoUploadAction = async () => ({});
const settings = (account: GuestAccount) =>
  renderToStaticMarkup(
    <CsrfProvider token="t">
      <SettingsScreen account={account} actions={{ signOut: async () => {}, toggleMarketing: async () => {}, disconnectGoogle: async () => {} }} />
    </CsrfProvider>,
  );

describe("avatar initial for guest screens", () => {
  it("first letter of the first name, else of the email", () => {
    expect(initialsOf(MARIA)).toBe("M");
    expect(initialsOf({ firstName: "", lastName: "", email: "zoe@example.com" })).toBe("Z");
  });
});

describe("Settings → PROFILE card", () => {
  it("shows the avatar initial, the full name and the headline", () => {
    const html = settings(MARIA);
    expect(html).toContain("María García");
    expect(html).toContain("Head of Risk · Globex · Barcelona");
    expect(html).toMatch(/aria-label="María García"[^>]*><span aria-hidden="true">M<\/span>/);
    expect(html).not.toContain("Add your name and photo");
    expect(html).toContain('href="/me/profile/edit"');
    expect(html).toContain("Primary email · confirmed");
  });

  it("shows the photo when one is stored", () => {
    expect(settings({ ...MARIA, photoUrl: "/api/me/photo?v=7" })).toContain('src="/api/me/photo?v=7"');
  });

  it("an account without a name gets the empty state with an Edit profile button", () => {
    const html = settings({ ...MARIA_NEW, firstName: "", lastName: "", headline: undefined, role: undefined, company: undefined, email: "zoe@example.com" });
    expect(html).toContain("Add your name and photo");
    expect(html).toMatch(/<a[^>]*href="\/me\/profile\/edit"[^>]*>Edit profile<\/a>/);
    expect(html).toMatch(/aria-label="zoe@example.com"[^>]*><span aria-hidden="true">Z<\/span>/);
    expect(html).toContain("zoe@example.com");
    // No empty header row with only "Edit".
    expect(html).not.toMatch(/<span class="[^"]*rowLabel[^"]*"><\/span>/);
  });
});

describe("Edit profile → PHOTO", () => {
  it("no photo: initial avatar, Upload photo, the type/size hint and no Remove", () => {
    render(<PhotoUploader name="María García" email="m@example.com" upload={noop} remove={noop} />);
    expect(host.querySelector('[role="img"]')!.textContent).toBe("M");
    expect(button(/Upload photo/)).toBeDefined();
    expect(button(/Remove/)).toBeUndefined();
    expect(host.textContent).toContain("JPG or PNG, up to 5 MB.");
  });

  it("a stored photo shows as the circle with Change and Remove", () => {
    render(<PhotoUploader name="María García" email="m@example.com" photoUrl="/api/me/photo?v=1" upload={noop} remove={noop} />);
    expect(host.querySelector("img")!.getAttribute("src")).toBe("/api/me/photo?v=1");
    expect(button(/^Change$/)).toBeDefined();
    expect(button(/^Remove$/)).toBeDefined();
  });

  it("choosing a file previews it at once, disables the buttons while uploading, then refreshes the page", async () => {
    const pending = deferred<{ saved: boolean }>();
    const upload = vi.fn<PhotoUploadAction>(() => pending.promise);
    const prepare = vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" }));
    render(<PhotoUploader name="María García" email="m@example.com" upload={upload} remove={noop} prepare={prepare} />);
    await choose(new File(["png"], "me.png", { type: "image/png" }));
    expect(host.querySelector("img")!.getAttribute("src")).toMatch(/^blob:preview-/);
    const busy = button(/Uploading…/)!;
    expect(busy.disabled).toBe(true);
    expect(prepare).toHaveBeenCalledOnce();
    const sent = upload.mock.calls[0]![1];
    expect(sent.get("csrf")).toBe("csrf-token");
    expect((sent.get("photo") as File).type).toBe("image/jpeg");
    await act(async () => pending.resolve({ saved: true }));
    expect(host.querySelector('[role="status"]')!.textContent).toBe("Photo updated.");
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(button(/^Change$/)!.disabled).toBe(false);
  });

  it("a server error shows inline and drops the preview", async () => {
    const upload = vi.fn<PhotoUploadAction>(async () => ({ error: "Use a 512 by 512 JPEG under 300 KB." }));
    render(<PhotoUploader name="María García" email="m@example.com" upload={upload} remove={noop} prepare={async () => new Blob(["x"], { type: "image/jpeg" })} />);
    await choose(new File(["jpg"], "me.jpg", { type: "image/jpeg" }));
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Use a 512 by 512 JPEG under 300 KB.");
    expect(host.querySelector("img")).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("a wrong type or a file over 5 MB is refused before any upload", async () => {
    const upload = vi.fn<PhotoUploadAction>(noop);
    render(<PhotoUploader name="María García" email="m@example.com" upload={upload} remove={noop} />);
    await choose(new File(["gif"], "me.gif", { type: "image/gif" }));
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("That file is not a JPG or PNG. Use a JPG or PNG under 5 MB.");
    const big = new File(["x"], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 14 * 1024 * 1024 });
    await choose(big);
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("The file is 14 MB. Use a JPG or PNG under 5 MB.");
    expect(upload).not.toHaveBeenCalled();
  });

  it("Remove posts with CSRF, falls back to the initial and refreshes", async () => {
    const remove = vi.fn<PhotoUploadAction>(async () => ({ removed: true }));
    render(<PhotoUploader name="María García" email="m@example.com" photoUrl="/api/me/photo?v=1" upload={noop} remove={remove} />);
    await act(async () => button(/^Remove$/)!.click());
    expect(remove.mock.calls[0]![1].get("csrf")).toBe("csrf-token");
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('[role="img"]')!.textContent).toBe("M");
    expect(host.querySelector('[role="status"]')!.textContent).toBe("Photo removed.");
    expect(router.refresh).toHaveBeenCalledOnce();
  });
});

describe("Edit profile → Save changes", () => {
  it("a save shows the success state and refreshes the header", async () => {
    const action = vi.fn<EditProfileAction>(async () => ({ saved: true, savedAt: 1 }));
    render(<EditProfileForm account={MARIA_NEW} action={action} photo={{ upload: noop, remove: noop }} />);
    const form = host.querySelector("form") as HTMLFormElement;
    await act(async () => form.requestSubmit());
    expect(action).toHaveBeenCalledOnce();
    const sent = action.mock.calls[0]![1];
    expect(sent.get("csrf")).toBe("csrf-token");
    expect(sent.get("headline")).toBe(MARIA_NEW.headline);
    expect(host.querySelector('[role="status"]')!.textContent).toContain("Profile saved.");
    expect(router.refresh).toHaveBeenCalledOnce();
  });
});

describe("/me pages share the public header", () => {
  const me = (account: GuestAccount) => renderToStaticMarkup(<CsrfProvider token="t"><MyEventsScreen account={account} events={[]} now={FIXED_NOW} /></CsrfProvider>);

  it("My events, Settings and Edit profile render the one site header, full width, with the avatar menu", () => {
    const pages = [
      me(MARIA),
      settings(MARIA),
      renderToStaticMarkup(<CsrfProvider token="t"><EditProfileForm account={MARIA} action={async () => ({})} photo={{ upload: noop, remove: noop }} /></CsrfProvider>),
    ];
    for (const html of pages) {
      expect(html).toContain("data-shared-header");
      // SiteHeader: 24px logo + EVENTS tag, Explore events, My events (hidden on phones by CSS) and the avatar menu button.
      expect(html).toMatch(/<header class="header"><div class="bar"><a href="\/events"[^>]*aria-label="Didit Events, all events"><img[^>]*height="24"/);
      expect(html).toContain(">EVENTS</span>");
      expect(html).toMatch(/<a href="\/events" class="[^"]*link[^"]*">Explore events<\/a>/);
      expect(html).toMatch(/<a href="\/me" class="[^"]*link[^"]*">My events<\/a>/);
      // One header (it adapts to its own width), so one logo and one avatar menu button.
      expect(html.match(/<header/g)).toHaveLength(1);
      expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(1);
      // The old narrow account bar (logo + avatar link inside the 480px column) is gone.
      expect(html).not.toContain(", my events");
    }
  });

  it("greets a nameless account with Hi there; the empty state keeps a normal-size Explore events button in the column", () => {
    const html = me({ ...MARIA_NEW, firstName: "", lastName: "", email: "zoe@example.com" });
    expect(html).toContain(">Hi there</h1>");
    expect(html).toContain("No events yet");
    const cta = html.match(/<a[^>]*href="\/events"[^>]*>Explore events<\/a>/g)!.find((a) => !/class="[^"]*\blink\b/.test(a))!;
    expect(cta).toBeDefined();
    expect(cta).not.toMatch(/\bblock\b|\bxl\b/);
    expect(html).toContain('href="/me/settings"');
    expect(me(MARIA)).toContain(">Hi María</h1>");
  });

  it("the avatar menu stacks above page content (opaque panel, header and menu z-index over the column)", () => {
    const css = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const menu = css("../public/components/AccountMenu.module.css");
    expect(menu).toMatch(/\.menu \{[^}]*position: absolute;[^}]*z-index: 100;[^}]*background: var\(--white, #fefefe\)/);
    const header = css("../public/components/SiteHeader.module.css");
    expect(header).toMatch(/\.header \{[^}]*position: relative; z-index: 50;/);
    const screen = css("./components/Screen.module.css");
    expect(screen).toMatch(/\.pageInShell \{[^}]*overflow: visible;/);
    expect(screen).toMatch(/\.pageInShell > \.body \{ z-index: auto; \}/);
  });
});
