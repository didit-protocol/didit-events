import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EventPage } from "./components/EventPage";
import { AI_ERA } from "./fixtures";
import type { PublicEvent } from "./types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

const page = (event: PublicEvent) => renderToStaticMarkup(<EventPage event={event} related={[]} viewer={null} staff={null} card={{ kind: "signed_out" } as never} now={new Date("2026-10-01T10:00:00Z")} actions={{} as never} />);

describe("guest list privacy (the public never sees who is going by default)", () => {
  it("hidden: no going count, no names, no avatars", () => {
    const html = page({ ...AI_ERA, guestList: "hidden" });
    expect(html).not.toMatch(/GOING/);
    for (const name of AI_ERA.goingPreview.names) expect(html).not.toContain(name);
  });
  it("count: only the number; names: the avatar stack and names", () => {
    const count = page({ ...AI_ERA, guestList: "count" });
    expect(count).toContain(`${AI_ERA.going} GOING`);
    expect(count).not.toContain(AI_ERA.goingPreview.names[0]!);
    expect(page({ ...AI_ERA, guestList: "names" })).toContain(AI_ERA.goingPreview.names[0]!);
  });
  it("hosts: listed when set, the section is omitted when empty", () => {
    expect(page({ ...AI_ERA, hosts: [{ name: "Uma Bramwell", role: "Host" }] })).toContain("Uma Bramwell");
    expect(page({ ...AI_ERA, hosts: [] })).not.toContain("HOSTED BY");
  });
});
