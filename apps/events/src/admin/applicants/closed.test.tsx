import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApplicantsView } from "./ApplicantsView";
import { closedNote } from "./closed";
import { AI_ERA_APPLICANTS, DESIGN_APPLICANTS, DESIGN_COUNTS } from "./fixtures";
import { parseApplicantQuery } from "./query";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/events/ai-era/applicants", useSearchParams: () => new URLSearchParams() }));

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const view = (event: Partial<typeof AI_ERA_APPLICANTS>) =>
  decode(renderToStaticMarkup(<ApplicantsView eventId="ai-era" query={parseApplicantQuery({})} counts={DESIGN_COUNTS} rows={DESIGN_APPLICANTS} event={{ ...AI_ERA_APPLICANTS, registration: "closed", ...event }} />));

describe("AP-25 closed banner: one rule for the copy and for “Reopen requests”", () => {
  it("a passed closing date names the date and can be reopened", () => {
    expect(closedNote({ closed: "date", closedOn: "Tue 6 Oct" }, 2)).toEqual({ text: "Requests closed on Tue 6 Oct. You can still decide on the 2 pending and invite people directly.", reopen: true });
    expect(view({ closed: "date", closedOn: "Tue 6 Oct" })).toContain("Reopen requests");
  });

  it("never prints an empty date", () => {
    for (const closed of ["date", "started", "ended", "cancelled", "draft", undefined] as const) {
      const { text } = closedNote({ closed }, 3);
      expect(text).not.toMatch(/ on \./);
      expect(text).not.toContain("undefined");
    }
    expect(closedNote({}, 1).text).toBe("Requests are closed. You can still decide on the 1 pending and invite people directly.");
  });

  it("a started, ended, cancelled or draft event says why and offers no reopen (it would not open anything)", () => {
    expect(closedNote({ closed: "started" }, 2)).toEqual({ text: "Requests closed when the event started and can’t be reopened. You can still decide on the 2 pending.", reopen: false });
    expect(closedNote({ closed: "started", closedOn: "Tue 6 Oct" }, 0).text).toBe("Requests closed when the event started and can’t be reopened.");
    expect(closedNote({ closed: "ended" }, 0)).toEqual({ text: "Requests are closed: the event has ended.", reopen: false });
    expect(closedNote({ closed: "cancelled" }, 4)).toEqual({ text: "Requests are closed: the event was cancelled.", reopen: false });
    expect(closedNote({ closed: "draft" }, 0).reopen).toBe(false);
    const started = view({ closed: "started" });
    expect(started).toContain("Requests closed when the event started and can’t be reopened.");
    expect(started).not.toContain("Reopen requests");
    expect(started).not.toContain("Requests closed on");
  });
});
