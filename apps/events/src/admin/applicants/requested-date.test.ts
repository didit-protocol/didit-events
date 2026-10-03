import { describe, expect, it } from "vitest";
import { shortDate } from "../../server/b4-views";

describe("Requests rows: the Requested and Cancelled dates", () => {
  it("are the day in the event's time zone, whatever zone the server runs in", () => {
    // 00:30 in Madrid on 9 Oct is still 8 Oct in UTC (the ECS default).
    const at = new Date("2026-10-08T22:30:00Z");
    expect(shortDate(at, "Europe/Madrid")).toBe("09/10/2026");
    expect(shortDate(at, "America/New_York")).toBe("08/10/2026");
    expect(shortDate(at)).toBe("08/10/2026");
  });
});
