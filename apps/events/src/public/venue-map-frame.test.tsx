// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VenueMapFrame } from "./components/VenueMapFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A controllable IntersectionObserver: the test decides when (and whether) the box is displayed and near. */
let observers: { cb: IntersectionObserverCallback; targets: Element[]; disconnected: boolean }[] = [];
let host: HTMLDivElement, root: Root;

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    private readonly entry: (typeof observers)[number];
    constructor(cb: IntersectionObserverCallback) { this.entry = { cb, targets: [], disconnected: false }; observers.push(this.entry); }
    observe(el: Element) { this.entry.targets.push(el); }
    disconnect() { this.entry.disconnected = true; }
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const fire = (isIntersecting: boolean) =>
  act(() => { for (const o of observers) o.cb(o.targets.map((target) => ({ isIntersecting, target }) as IntersectionObserverEntry), {} as IntersectionObserver); });

describe("VenueMapFrame: the embed mounts only where its box is displayed", () => {
  it("stays a placeholder while its layout is hidden (never intersecting), then mounts one lazy iframe", () => {
    act(() => root.render(<VenueMapFrame src="https://maps.google.com/maps?q=x&output=embed" title="Map of Didit HQ" />));
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("[data-venue-map-pending]")).not.toBeNull();
    expect(observers).toHaveLength(1);
    // A layout that is display: none reports "not intersecting" (or nothing at all): still no embed.
    fire(false);
    expect(host.querySelector("iframe")).toBeNull();
    fire(true);
    const frames = host.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.getAttribute("src")).toBe("https://maps.google.com/maps?q=x&output=embed");
    expect(frames[0]!.getAttribute("title")).toBe("Map of Didit HQ");
    expect(frames[0]!.getAttribute("loading")).toBe("lazy");
    expect(host.querySelector("[data-venue-map-pending]")).toBeNull();
    expect(observers[0]!.disconnected).toBe(true);
  });
});
