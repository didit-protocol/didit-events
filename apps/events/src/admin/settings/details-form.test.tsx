// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetailsForm } from "./DetailsForm";

const actions = vi.hoisted(() => ({ saveDetailsAction: vi.fn() }));
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/settings/actions", () => actions);
vi.mock("../system/session", () => ({ handleSessionExpired: (r: { error?: string }) => r.error === "session_expired" }));
vi.mock("@didit-events/ui", async original => ({ ...await original<object>(), toast: vi.fn() }));

let host: HTMLDivElement, root: Root;
const router = { bfcacheId: "test", push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (element: ReactElement) => act(() => root.render(<AppRouterContext.Provider value={router}>{element}</AppRouterContext.Provider>));
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text);
const nameInput = () => host.querySelector<HTMLInputElement>("input")!;
const type = (input: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const details = (name: string) => ({ name, date: "2026-11-12", start: "19:00", end: "22:00", timeZone: "Europe/Madrid" });
const form = (name: string, editVersion: number) => <DetailsForm eventId="evt" initial={details(name)} editVersion={editVersion} />;

it("a clean form follows refreshed values and saves against the refreshed edit version", async () => {
  render(form("Opening", 4));
  render(form("Opening night", 7)); // e.g. after a lifecycle change or another tab saved
  expect(nameInput().value).toBe("Opening night");
  type(nameInput(), "Opening party");
  actions.saveDetailsAction.mockResolvedValue({ ok: true, editVersion: 8 });
  await act(async () => button("Save details")!.click());
  expect(actions.saveDetailsAction).toHaveBeenCalledWith("evt", expect.objectContaining({ name: "Opening party" }), 7, expect.any(String));
});

it("a conflict offers explicit recovery: reload takes the latest values and version", async () => {
  render(form("Opening", 4));
  type(nameInput(), "Mine");
  render(form("Theirs", 5)); // someone else saved while we were editing: our edits stay
  expect(nameInput().value).toBe("Mine");
  actions.saveDetailsAction.mockResolvedValue({ error: "conflict" });
  await act(async () => button("Save details")!.click());
  expect(actions.saveDetailsAction).toHaveBeenLastCalledWith("evt", expect.objectContaining({ name: "Mine" }), 4, expect.any(String));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Someone else changed this event");
  expect(button("Discard")).toBeUndefined();
  await act(async () => button("Reload latest details")!.click());
  expect(nameInput().value).toBe("Theirs");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(router.refresh).toHaveBeenCalled();
  type(nameInput(), "Mine again");
  actions.saveDetailsAction.mockResolvedValue({ ok: true, editVersion: 6 });
  await act(async () => button("Save details")!.click());
  expect(actions.saveDetailsAction).toHaveBeenLastCalledWith("evt", expect.objectContaining({ name: "Mine again" }), 5, expect.any(String));
});
