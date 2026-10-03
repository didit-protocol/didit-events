import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HomeError from "../../app/(home)/error";
import HomeLoading from "../../app/(home)/loading";
import EventError from "../../app/e/[slug]/error";
import EventLoading from "../../app/e/[slug]/loading";
import EventNotFoundPage from "../../app/e/[slug]/not-found";
import DoneLoading from "../../app/e/[slug]/done/loading";
import InviteLoading from "../../app/e/[slug]/v/[token]/loading";
import EventsError from "../../app/events/error";
import EventsLoading from "../../app/events/loading";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("route loading / error / not-found states", () => {
  it.each([
    ["/", HomeLoading, "Loading events…"],
    ["/events", EventsLoading, "Loading events…"],
    ["/e/[slug]", EventLoading, "Loading event…"],
    ["/e/[slug]/v/[token]", InviteLoading, "Loading…"],
    ["/e/[slug]/done", DoneLoading, "Loading…"],
  ])("%s loading skeleton is announced as busy", (_route, Loading, text) => {
    const out = html(<Loading />);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain(text);
  });

  it("error boundaries offer a retry that calls reset", () => {
    const reset = vi.fn();
    for (const Err of [EventError, EventsError, HomeError]) {
      const out = html(<Err error={new Error("x")} reset={reset} />);
      expect(out).toContain("Try again");
    }
    expect(html(<EventError error={new Error("x")} reset={reset} />)).toContain('role="alert"');
  });

  it("unknown event shows G-01i", () => {
    expect(html(<EventNotFoundPage />)).toContain("We can’t find this event");
  });
});
