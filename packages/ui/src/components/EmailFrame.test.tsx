// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMAIL_FRAME_VIEWPORT_H, EmailFrame } from "./EmailFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for the iframe's document: controllable body height, fonts.ready and ResizeObserver. */
class FakeDoc extends EventTarget {
  readyState = "complete";
  bodyHeight = 0;
  measured = 0;
  fontsResolve!: () => void;
  fonts = { ready: new Promise<void>((r) => (this.fontsResolve = r)) };
  observers: FakeObserver[] = [];
  body = { getBoundingClientRect: () => (this.measured++, { height: this.bodyHeight }) };
  window = { ResizeObserver: makeObserver(this) };
}

interface FakeObserver {
  fire: () => void;
  disconnected: boolean;
}

function makeObserver(doc: FakeDoc) {
  return class implements FakeObserver {
    disconnected = false;
    constructor(private cb: () => void) {
      doc.observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
    fire() {
      this.cb();
    }
  };
}

let current: FakeDoc;
let host: HTMLDivElement;
let root: Root;
const proto = HTMLIFrameElement.prototype;
const original = {
  doc: Object.getOwnPropertyDescriptor(proto, "contentDocument")!,
  win: Object.getOwnPropertyDescriptor(proto, "contentWindow")!,
};

beforeEach(() => {
  current = new FakeDoc();
  Object.defineProperty(proto, "contentDocument", { configurable: true, get: () => current });
  Object.defineProperty(proto, "contentWindow", { configurable: true, get: () => current.window });
  host = document.createElement("div");
  // jsdom loads srcdoc itself; keep its (trusted) load events away so only the test's events drive the frame.
  host.addEventListener("load", (e) => e.isTrusted && e.stopPropagation(), true);
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(proto, "contentDocument", original.doc);
  Object.defineProperty(proto, "contentWindow", original.win);
});

const iframe = () => host.querySelector("iframe")!;
const height = () => iframe().style.height;

describe("EmailFrame measuring", () => {
  it("starts at the viewport height, then follows the document through load, fonts, images and resizes", async () => {
    current.readyState = "loading";
    act(() => root.render(<EmailFrame html="<p>a</p>" title="t" />));
    expect(height()).toBe(`${EMAIL_FRAME_VIEWPORT_H}px`);

    const doc = current;
    doc.readyState = "complete";
    doc.bodyHeight = 610.2;
    act(() => void iframe().dispatchEvent(new Event("load")));
    expect(height()).toBe("611px");

    doc.bodyHeight = 700;
    await act(async () => doc.fontsResolve());
    expect(height()).toBe("700px");

    doc.bodyHeight = 720;
    act(() => doc.dispatchEvent(new Event("load"))); // an image finished
    expect(height()).toBe("720px");

    doc.bodyHeight = 740;
    act(() => doc.observers[0]!.fire());
    expect(height()).toBe("740px");
  });

  it("uses the caller's initial height", () => {
    current.readyState = "loading";
    act(() => root.render(<EmailFrame html="<p>a</p>" title="t" initialHeight={1400} />));
    expect(height()).toBe("1400px");
  });

  it("drops the previous document's pending work when html changes", async () => {
    act(() => root.render(<EmailFrame html="<p>a</p>" title="t" />));
    const first = current;
    expect(first.observers).toHaveLength(1);

    current = new FakeDoc();
    act(() => root.render(<EmailFrame html="<p>b</p>" title="t" />));
    const second = current;
    expect(first.observers[0]!.disconnected).toBe(true);
    const before = first.measured + second.measured;
    second.bodyHeight = 999;
    // The old document's fonts, observer and image listeners must not measure (whichever document is current).
    await act(async () => first.fontsResolve());
    act(() => first.observers[0]!.fire());
    act(() => first.dispatchEvent(new Event("load")));
    expect(first.measured + second.measured).toBe(before);
    expect(height()).not.toBe("999px");
  });

  it("does no measuring (and so no setState) after unmount", async () => {
    act(() => root.render(<EmailFrame html="<p>a</p>" title="t" />));
    const doc = current;
    const frame = iframe();
    const before = doc.measured;
    act(() => root.unmount());
    root = createRoot(host); // afterEach unmounts again

    expect(doc.observers[0]!.disconnected).toBe(true);
    doc.bodyHeight = 999;
    await act(async () => doc.fontsResolve());
    act(() => doc.observers[0]!.fire());
    act(() => doc.dispatchEvent(new Event("load")));
    act(() => void frame.dispatchEvent(new Event("load")));
    expect(doc.measured).toBe(before);
    expect(doc.observers).toHaveLength(1);
  });
});
