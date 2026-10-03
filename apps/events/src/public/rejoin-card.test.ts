/** v5 re-join on the event page's card: Request again only when the server's rule allows it, else the reason. */
import { describe, expect, it } from "vitest";
import { cardContent } from "./card";
import { AI_ERA } from "./fixtures";

describe("registration card after a cancel / withdraw / rejection", () => {
  it("withdrew and may request again: the rule and the action open the join modal", () => {
    const c = cardContent({ kind: "cancelled", by: "withdrew", again: { label: "Request again", rule: "Your request goes back to the hosts." } }, AI_ERA);
    expect(c).toMatchObject({ title: "You withdrew your request", body: "Your request goes back to the hosts.", cta: { label: "Request again", href: `/e/${AI_ERA.slug}?join=1` } });
  });
  it("cancelled and the re-request is used up: the reason, no Request again", () => {
    const c = cardContent({ kind: "cancelled", by: "guest", again: { label: null, rule: "You already requested again once. To change it, email the hosts." } }, AI_ERA);
    expect(c.title).toBe("You cancelled your place");
    expect(c.body).toMatch(/already requested again once/);
    expect(c.cta).toBeUndefined();
  });
  it("cancelled by the hosts or the event: never a self-rejoin", () => {
    const host = cardContent({ kind: "cancelled", by: "host" }, AI_ERA), gone = cardContent({ kind: "cancelled", by: "event" }, AI_ERA);
    expect(host).toMatchObject({ title: "The hosts cancelled your place", cta2: { label: "Email the hosts" } });
    expect(gone.title).toBe("This event was cancelled");
    expect(host.cta ?? gone.cta).toBeUndefined();
  });
  it("declined: one more request when allowed, else the subscribe card", () => {
    expect(cardContent({ kind: "not_approved", again: { label: "Request again", rule: "The hosts look at a second request once." } }, AI_ERA).cta).toMatchObject({ label: "Request again" });
    expect(cardContent({ kind: "not_approved", again: { label: null, rule: "x" } }, AI_ERA).cta).toMatchObject({ action: "subscribe" });
  });
});
