// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventForm } from "./EventForm";
import { BCN_FORM, BCN_WELCOME, EMPTY_EVENT } from "./fixtures";
import type { EventFormState } from "./types";
import type { PlacesFetch } from "./LocationField";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (el: ReactElement) => act(() => root.render(el));
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const type = (input: HTMLInputElement, value: string) => act(() => { setValue.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const key = (el: HTMLElement, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
const byLabel = (text: string) => {
  const label = [...host.querySelectorAll("label")].find((l) => l.textContent?.replace(" · optional", "") === text);
  return host.querySelector<HTMLInputElement>(`#${CSS.escape(label!.htmlFor)}`)!;
};
const flush = async (ms = 5) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const posted = () => new FormData(host.querySelector("form")!);

function form(values = EMPTY_EVENT, extra: { placesEnabled?: boolean; placesFetch?: PlacesFetch; action?: (prev: EventFormState, fd: FormData) => Promise<EventFormState> } = {}) {
  const action = extra.action ?? vi.fn(async (_p: EventFormState, _fd: FormData): Promise<EventFormState> => ({ status: "idle", values }));
  render(<EventForm mode="new" crumb="New event" cancelHref="/admin" action={action} initialState={{ status: "idle", values }} welcome={BCN_WELCOME} placesEnabled={extra.placesEnabled} placesFetch={extra.placesFetch} />);
  return action;
}

describe("EventForm live validation", () => {
  it("blur shows the field's message inline with aria-invalid + aria-describedby; typing a valid value clears it", () => {
    form();
    const name = byLabel("Event name");
    act(() => { name.focus(); name.blur(); });
    expect(name.getAttribute("aria-invalid")).toBe("true");
    const describedBy = name.getAttribute("aria-describedby")!;
    expect(host.querySelector(`#${CSS.escape(describedBy.split(" ")[0]!)}`)!.textContent).toBe("Give the event a name");
    type(name, "Barcelona Office Opening");
    expect(name.hasAttribute("aria-invalid")).toBe(false);
    expect(host.textContent).not.toContain("Give the event a name");
  });

  it("submit runs the same rules on the client: nothing is posted, the banner counts, the first invalid field gets focus", async () => {
    const action = form({ ...EMPTY_EVENT, name: "x" });
    const venue = byLabel("Venue");
    type(venue, "Didit HQ");
    await act(async () => host.querySelector("form")!.requestSubmit());
    expect(action).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/Fix \d+ fields before saving\./);
    expect(host.textContent).toContain("Pick a date");
    expect(document.activeElement).toBe(host.querySelector("button[aria-haspopup=dialog]"));
    expect(host.querySelector("button[aria-haspopup=dialog]")!.getAttribute("aria-invalid")).toBe("true");
  });

  it("leaving an empty time field shows its message; picking a slot clears it", () => {
    form({ ...BCN_FORM, start: "", end: "" });
    const start = byLabel("Start");
    act(() => { start.focus(); start.blur(); });
    expect(host.textContent).toContain("Add a start time");
    // Opening an empty start field highlights 19:00; Enter picks it.
    act(() => start.focus());
    key(start, "Enter");
    expect(start.value).toBe("19:00");
    expect(host.textContent).not.toContain("Add a start time");
  });

  it("the end picker offers only times after the start and shows the duration", () => {
    form({ ...BCN_FORM, end: "" });
    const end = byLabel("End");
    act(() => end.focus());
    const options = [...host.querySelectorAll<HTMLElement>(`#${CSS.escape(end.getAttribute("aria-controls")!)} [role=option]`)];
    expect(options[0]!.textContent).toBe("19:1515 min");
    expect(options.find((o) => o.textContent!.startsWith("22:30"))!.textContent).toContain("3 h 30 min");
    type(end, "10:30pm");
    act(() => end.blur());
    expect(end.value).toBe("22:30");
    expect(host.textContent).toContain("3 h 30 min");
  });

  it("a valid form posts ISO date, HH:MM times, plain-digit capacity, the timezone and the composed address", async () => {
    const action = form(BCN_FORM);
    await act(async () => host.querySelector("form")!.requestSubmit());
    await flush();
    expect(action).toHaveBeenCalledTimes(1);
    const fd = (action as ReturnType<typeof vi.fn>).mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(["date", "start", "end", "timezone", "capacity", "venue", "address", "street", "city", "postalCode", "country", "placeId"].map((k) => [k, fd.get(k)]))).toEqual({
      date: "2026-10-23", start: "19:00", end: "23:00", timezone: "Europe/Madrid", capacity: "150", venue: "Didit HQ",
      address: "Carrer de Pallars 99, 08018 Barcelona, Spain", street: "Carrer de Pallars 99", city: "Barcelona", postalCode: "08018", country: "Spain", placeId: "",
    });
  });

  it("the timezone combobox finds 'New York' and shows the UTC offset for the event day", () => {
    form(BCN_FORM);
    const tz = byLabel("Timezone");
    act(() => tz.focus());
    type(tz, "new york");
    const opts = [...host.querySelectorAll<HTMLElement>(`#${CSS.escape(tz.getAttribute("aria-controls")!)} [role=option]`)];
    expect(opts.map((o) => o.textContent)).toEqual(["New York · America/New_YorkUTC-04:00"]);
    key(tz, "ArrowDown");
    key(tz, "Enter");
    expect(posted().get("timezone")).toBe("America/New_York");
    expect(host.textContent).toContain("UTC-04:00");
  });
});

describe("EventForm location", () => {
  it("no Google Maps key: structured manual fields, validation, and no network calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    form({ ...EMPTY_EVENT, name: "Dinner" });
    for (const l of ["Venue", "Street", "City", "Postal code", "Country"]) expect(byLabel(l)).toBeTruthy();
    expect(host.querySelector("input[role=combobox][placeholder='Search a venue or address']")).toBeNull();
    type(byLabel("Street"), "Carrer de Pallars 99");
    act(() => byLabel("City").focus());
    act(() => byLabel("City").blur());
    expect(host.textContent).toContain("Add the city");
    type(byLabel("City"), "Barcelona");
    expect(host.textContent).not.toContain("Add the city");
    expect(posted().get("address")).toBe("Carrer de Pallars 99, Barcelona");
    await flush(20);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  const suggestions = { suggestions: [{ placeId: "ChIJ5TCOcRaYpBIRCmZHTz37sEQ", main: "Didit HQ", secondary: "Carrer de Pallars, Barcelona, Spain" }] };
  const place = { placeId: "ChIJ5TCOcRaYpBIRCmZHTz37sEQ", name: "Didit HQ", formattedAddress: "Carrer de Pallars, 99, 08018 Barcelona, Spain", street: "Carrer de Pallars, 99", city: "Barcelona", postalCode: "08018", country: "Spain", lat: 41.4036, lng: 2.1916, mapsUrl: "https://maps.google.com/?cid=4949212542133135882" };

  it("with Places: type ≥ 3 characters → suggestions, keyboard pick → venue + address + summary, 'Edit manually' unpins", async () => {
    const urls: string[] = [];
    const fetcher: PlacesFetch = async (url) => { urls.push(url); return Response.json(url.includes("autocomplete") ? suggestions : { place }); };
    form(EMPTY_EVENT, { placesEnabled: true, placesFetch: fetcher });
    const search = host.querySelector<HTMLInputElement>("input[role=combobox][placeholder='Search a venue or address']")!;
    type(search, "Di");
    await flush(300);
    expect(urls).toHaveLength(0);
    type(search, "Didit");
    await flush(300);
    expect(urls[0]).toMatch(/^\/api\/admin\/places\/autocomplete\?q=Didit&session=[A-Za-z0-9_-]{8,}$/);
    const option = host.querySelector<HTMLElement>(`#${CSS.escape(search.getAttribute("aria-controls")!)} [role=option]`)!;
    expect(option.textContent).toBe("Didit HQCarrer de Pallars, Barcelona, Spain");
    key(search, "ArrowDown");
    key(search, "Enter");
    await flush();
    const session = /session=([^&]+)/.exec(urls[0]!)![1];
    expect(urls[1]).toBe(`/api/admin/places/details?id=ChIJ5TCOcRaYpBIRCmZHTz37sEQ&session=${session}`);
    const summary = host.querySelector("[aria-label='Selected location']")!;
    expect(summary.textContent).toContain("Didit HQ");
    expect(summary.textContent).toContain("Carrer de Pallars, 99, 08018 Barcelona, Spain");
    expect(summary.textContent).toContain("08018");
    expect(Object.fromEntries(["venue", "address", "placeId", "lat", "lng", "mapsUrl"].map((k) => [k, posted().get(k)]))).toEqual({
      venue: "Didit HQ", address: place.formattedAddress, placeId: place.placeId, lat: "41.4036", lng: "2.1916", mapsUrl: place.mapsUrl,
    });
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Edit manually")!.click());
    expect(byLabel("Street").value).toBe("Carrer de Pallars, 99");
    expect(posted().get("placeId")).toBe("");
    expect(posted().get("address")).toBe("Carrer de Pallars, 99, 08018 Barcelona, Spain");
  });

  it("with Places: a failing search falls back to the manual fields with a note", async () => {
    form(EMPTY_EVENT, { placesEnabled: true, placesFetch: async () => new Response(null, { status: 502 }) });
    type(host.querySelector<HTMLInputElement>("input[role=combobox][placeholder='Search a venue or address']")!, "Didit");
    await flush(300);
    expect(host.textContent).toContain("Google Maps search is unavailable right now. Enter the address manually.");
    expect(byLabel("Street")).toBeTruthy();
  });
});
