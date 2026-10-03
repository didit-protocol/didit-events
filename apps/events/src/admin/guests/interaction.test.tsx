// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddGuests } from "./AddGuests";
import { GuestDrawer } from "./GuestDrawer";
import { mariaDetail } from "./fixtures";
import * as ui from "@didit-events/ui";

const actions = vi.hoisted(() => ({ addGuestAction: vi.fn(), addGuestBatchAction: vi.fn(), resolveEmailMismatchAction: vi.fn() }));
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/guests/actions", () => actions);
vi.mock("../useAdminRouter", () => ({ useAdminRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const setArea = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
const input = (name: string) => host.querySelector(`[name="${name}"]`) as HTMLInputElement & HTMLTextAreaElement;
const type = (name: string, value: string) =>
  act(() => {
    const el = input(name);
    (el instanceof HTMLTextAreaElement ? setArea : setInput).call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

it("A-16 submits the exact session and email the staff member reviewed", async () => {
  const toast = vi.spyOn(ui, "toast").mockReturnValue(0);
  const detail = mariaDetail("email-mismatch");
  actions.resolveEmailMismatchAction.mockResolvedValue({ ok: true });
  act(() => root.render(<GuestDrawer eventId="event" detail={detail} closeHref="/x" inline />));
  const button = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === "Accept this email")!;
  await act(async () => button.click());
  expect(actions.resolveEmailMismatchAction).toHaveBeenCalledWith("event", detail.id, "accept", expect.any(String), {
    session: detail.verification.session, email: detail.mismatch!.verified,
  });
  expect(toast).toHaveBeenCalledWith({ message: "Email accepted." });
});

describe("A-07 one guest: invalid result keeps every field", () => {
  it("invalid email with send off → after the re-render send is still off and the fields keep their values", async () => {
    actions.addGuestAction.mockImplementation(async (_eventId: string, _prev: unknown, form: FormData) => ({
      status: "invalid",
      errors: { email: "Enter a valid email, like name@company.com" },
      values: { first: String(form.get("first")), last: String(form.get("last")), email: String(form.get("email")), note: String(form.get("note")), send: form.get("send") === "on" },
    }));
    act(() => root.render(<AddGuests eventId="bcn-opening" closeHref="/x" existingEmails={[]} inline />));
    expect(input("send").checked).toBe(true);
    type("first", "Ana");
    type("last", "Soler");
    type("email", "ana@nowhere");
    type("note", "Plus one");
    await act(async () => input("send").click());
    expect(input("send").checked).toBe(false);

    await act(async () => (host.querySelector("form") as HTMLFormElement).requestSubmit());

    expect(actions.addGuestAction).toHaveBeenCalledTimes(1);
    const sent = actions.addGuestAction.mock.calls[0]![2] as FormData;
    expect(sent.get("send")).toBeNull();
    expect(host.textContent).toContain("Enter a valid email, like name@company.com");
    expect(input("send").checked).toBe(false);
    expect(input("first").value).toBe("Ana");
    expect(input("last").value).toBe("Soler");
    expect(input("email").value).toBe("ana@nowhere");
    expect(input("note").value).toBe("Plus one");
    const cta = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add guest")!;
    expect(cta.disabled).toBe(false);
  });
});
