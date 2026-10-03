vi.mock("../../auth/access", () => { const staff = { principal: "staff", email: "fixture@didit.me", role: "owner" }; return { staffPage: async () => staff, requireEventAccess: async () => staff, eventAccess: async (id: string) => ({ actor: staff, event: { id, slug: id }, viewer: { kind: "staff", staff, email: staff.email } }) }; });
// @vitest-environment jsdom
import { act, Children, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InviteModal } from "./InviteModal";
import { RejectDialog } from "./Dialogs";
import { RequirementsModal } from "./RequirementsModal";
import { RoutedEventHeader } from "../event/RoutedEventHeader";
import { DEFAULT_REQUIREMENTS, SHARE_LINKS, AI_ERA } from "./fixtures";
import { BCN_SETTINGS } from "../settings/fixtures";

const actions = vi.hoisted(() => ({ inviteAction: vi.fn(), shareLinkAction: vi.fn(), saveRequirementsAction: vi.fn() }));
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions", () => actions);
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/applicants/data", () => ({ getRequirements: async () => DEFAULT_REQUIREMENTS }));
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/settings/data", () => ({ getSettings: async () => BCN_SETTINGS }));
vi.mock("../../../app/admin/(events)/events/[id]/data", () => ({ requireEvent: async (id: string) => ({ id, slug: id }) }));
const expired = vi.hoisted(() => vi.fn((r: { error?: string }) => r.error === "session_expired"));
vi.mock("../system/session", () => ({ handleSessionExpired: expired }));
vi.mock("next/navigation", () => ({ useSelectedLayoutSegment: () => "applicants", notFound: () => { throw new Error("404"); } }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@didit-events/ui", async original => ({ ...await original<object>(), toast }));
let host: HTMLDivElement, root: Root;
const router = { bfcacheId: "test", push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.clearAllMocks(); for (const action of Object.values(actions)) action.mockReset(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (element: ReactElement) => act(() => root.render(<AppRouterContext.Provider value={router}>{element}</AppRouterContext.Provider>));
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
const invite = (emails: string[]) => <InviteModal eventId="arbitrary" tab="email" closeHref="/close" existingEmails={["old@example.test"]} links={SHARE_LINKS} inline initial={{ emails }} />;
const summary = (invited = 1) => ({ ok: true, summary: { invited, approvedExisting: 0, waitlisted: 0, skippedInvalid: 0, alreadyRequested: 0 } });

it("InviteModal excludes invalid emails, deduplicates, advances progress and totals completed results", async () => {
  let release!: (result: ReturnType<typeof summary>) => void;
  actions.inviteAction.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValueOnce({ ...summary(0), summary: { ...summary(0).summary, waitlisted: 1 } });
  render(invite(["a@example.test", "A@example.test", "bad", "b@example.test"]));
  await click("Send 2 invites");
  expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("0");
  expect(actions.inviteAction).toHaveBeenCalledTimes(1);
  await act(async () => release(summary()));
  expect(actions.inviteAction).toHaveBeenCalledTimes(2);
  expect(actions.inviteAction.mock.calls.map(c => c[1])).toEqual([["a@example.test"], ["b@example.test"]]);
  expect(host.textContent).toContain("1 invite sent"); expect(host.textContent).toContain("1 invalid email"); expect(host.textContent).toContain("Waitlisted (event full)");
});
it.each(["returned", "thrown"])("InviteModal stops on %s error and sends nothing later", async failure => {
  actions.inviteAction.mockResolvedValueOnce(summary());
  if (failure === "returned") actions.inviteAction.mockResolvedValueOnce({ error: "conflict" }); else actions.inviteAction.mockRejectedValueOnce(new Error("Network"));
  render(invite(["a@example.test", "b@example.test", "c@example.test"])); await click("Send 3 invites");
  expect(actions.inviteAction).toHaveBeenCalledTimes(2); expect(host.querySelector('[role="alert"]')?.textContent).toContain("Nothing after the failed one was sent");
});
it("empty InviteModal confirms with the required validation message", async () => {
  render(invite(["invalid"])); await click("Send invites");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Add at least one valid email."); expect(actions.inviteAction).not.toHaveBeenCalled();
});
it("skip approval off labels an existing requester correctly and reports it in the summary", async () => {
  actions.inviteAction.mockResolvedValue({ ...summary(0), summary: { ...summary(0).summary, alreadyRequested: 1 } });
  render(invite(["old@example.test"]));
  const toggle = [...host.querySelectorAll("label")].find(l => l.textContent?.includes("Skip approval"))!.querySelector<HTMLInputElement>("input")!;
  await act(async () => toggle.click()); expect(host.textContent).toContain("Already requested · stays pending");
  await click("Send 1 invite"); expect(actions.inviteAction.mock.calls[0]![3]).toBe(false); expect(host.textContent).toContain("Already requested"); expect(host.textContent).toContain("0 invites sent");
});
it("RejectDialog confirm without a reason shows Pick a reason and never dispatches", async () => {
  const confirm = vi.fn(); render(<RejectDialog inline names={["Ana"]} onClose={() => {}} onConfirm={confirm} />); await click("Reject");
  expect(host.textContent).toContain("Pick a reason. Staff see it in the Rejected tab."); expect(confirm).not.toHaveBeenCalled();
});
it.each(["success", "error", "expired", "thrown"])("RequirementsModal handles %s", async outcome => {
  if (outcome === "thrown") actions.saveRequirementsAction.mockRejectedValue(new Error("Network"));
  else actions.saveRequirementsAction.mockResolvedValue(outcome === "success" ? { ok: true } : { error: outcome === "expired" ? "session_expired" : "conflict" });
  render(<RequirementsModal eventId="any-event" initial={DEFAULT_REQUIREMENTS} closeHref="/settings" inline />); await click("Save requirements");
  expect(actions.saveRequirementsAction).toHaveBeenCalledWith("any-event", DEFAULT_REQUIREMENTS, expect.any(String));
  if (outcome === "success") { expect(router.refresh).toHaveBeenCalledOnce(); expect(router.push).toHaveBeenCalledWith("/settings", { scroll: false }); }
  else { expect(router.push).not.toHaveBeenCalled(); if (outcome !== "expired") expect(host.querySelector('[role="alert"]')).not.toBeNull(); else expect(expired).toHaveReturnedWith(true); }
});
it("RequirementsModal: compact two-column switch rows, locked ones stay on, a label click toggles", async () => {
  actions.saveRequirementsAction.mockResolvedValue({ ok: true });
  render(<RequirementsModal eventId="any-event" initial={DEFAULT_REQUIREMENTS} closeHref="/settings" inline />);
  const switches = [...host.querySelectorAll<HTMLInputElement>('input[role="switch"]')];
  expect(switches.map(s => s.closest("label")?.textContent)).toEqual(["EmailAlways on · one-time code", "Selfie · livenessAlways on · face check-in", "Full nameMatched to the selfie", "Age 18+Events serving alcohol", "ID documentNot available for this event"]);
  expect(switches.map(s => [s.checked, s.disabled])).toEqual([[true, true], [true, true], [true, false], [false, false], [false, true]]);
  await act(async () => { (switches[3]!.closest("label")!.querySelector("span:last-child") as HTMLElement).click(); });
  expect(switches[3]!.checked).toBe(true);
  await click("Save requirements");
  expect(actions.saveRequirementsAction).toHaveBeenCalledWith("any-event", { ...DEFAULT_REQUIREMENTS, age18: true }, expect.any(String));
});
it("settings ?requirements=1 mounts the requirements modal for the requested event", async () => {
  const Page = (await import("../../../app/admin/(events)/events/[id]/(tabs)/settings/page")).default;
  const el = await Page({ params: Promise.resolve({ id: "any-event" }), searchParams: Promise.resolve({ requirements: "1" }) });
  const kids = Children.toArray(el.props.children) as ReactElement<{ eventId?: string }>[];
  expect(kids.some(k => k.props.eventId === "any-event")).toBe(true);
});
it("RoutedEventHeader reflects refreshed applicant counts after a decision", () => {
  render(<RoutedEventHeader event={{ ...AI_ERA, requestCount: 7 }} />); expect(host.textContent).toContain("7");
  render(<RoutedEventHeader event={{ ...AI_ERA, requestCount: 6 }} />);
  const tab = [...host.querySelectorAll("a")].find(a => a.textContent?.includes("Requests")); expect(tab?.textContent).toContain("6"); expect(tab?.textContent).not.toContain("7");
});
