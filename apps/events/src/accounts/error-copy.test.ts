import { describe, expect, it } from "vitest";
import { errorCopy } from "./api-client";

describe("errorCopy", () => {
  it("keeps the server's sentence and never shows a bare code", () => {
    expect(errorCopy({ code: "invalid", message: "Consent is required" })).toBe("Consent is required");
    expect(errorCopy({ code: "provider_unavailable", message: "provider_unavailable" })).toBe("Something went wrong on our side. Try again in a moment.");
    expect(errorCopy({ code: "closed", message: "closed" })).toBe("Requests for this event are closed.");
    expect(errorCopy({ code: "budget", message: "" })).not.toMatch(/_/);
  });
});
