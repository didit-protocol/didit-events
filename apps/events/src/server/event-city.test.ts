import type { DomainEvent } from "@didit-events/core";
import { describe,expect,it } from "vitest";
import { venueLabel } from "../public/format";
import { eventCity,publicEvent } from "./b4-views";

const event = (over: Partial<DomainEvent>) => ({
  form:{mode:"open",closes_at:null,questions:[],fields:{phone_number:"off"}},checks:{version:1,required:[],max_age:{}},door:{kiosk:false},descriptionMd:"Drinks",
  id: "e1", slug: "lx", name: "Founders night", status: "published", registrationMode: "open", registrationClosesAt: null, capacity: 80,
  startsAt: new Date("2026-11-05T18:00:00Z"), endsAt: new Date("2026-11-05T21:00:00Z"), timezone: "Europe/Lisbon",
  // v2 always stores an explicit theme or asset cover.
  description: "Drinks", agenda: [], speakers: [], cover: {kind:"theme",theme:"aqua"}, venue: "LX Factory", address: null, mapsUrl: null, ...over,
}) as unknown as DomainEvent;

describe("public event city (never a hard-coded default)", () => {
  it("an event in Lisbon shows Lisbon, from the manual address or from Google's formatted address", () => {
    const manual = publicEvent(event({ address: "Rua Rodrigues de Faria 103, 1300-501 Lisbon, Portugal" }));
    expect(manual.venue.city).toBe("Lisbon");
    expect(venueLabel(manual.venue)).toBe("LX Factory, Lisbon");
    expect(publicEvent(event({ address: "R. Rodrigues de Faria 103, 1300-501 Lisboa, Portugal", mapsUrl: "https://maps.google.com/?cid=1" })).venue.city).toBe("Lisboa");
  });
  it("reads the city segment for other address shapes", () => {
    expect(eventCity({ address: "Carrer de Pallars, 99, Sant Martí, 08018 Barcelona, Spain" })).toBe("Barcelona");
    expect(eventCity({ address: "1 Market St, San Francisco, CA 94105, USA" })).toBe("San Francisco");
    expect(eventCity({ address: "Pier 27, The Embarcadero, San Francisco" })).toBe("San Francisco");
    expect(eventCity({ address: "Carrer de Pallars 99, 08018 Barcelona" })).toBe("Barcelona");
    expect(eventCity({ address: "Lisbon" }, "Porto")).toBe("Porto");
  });
  it("no city in the address → the city is omitted (not Barcelona) and the label is just the venue", () => {
    const view = publicEvent(event({ address: "Rua Augusta 100" }));
    expect(view.venue.city).toBeUndefined();
    expect(venueLabel(view.venue)).toBe("LX Factory");
    expect(publicEvent(event({ address: null })).venue.city).toBeUndefined();
    expect(eventCity({ address: "Main St 1, 08018" })).toBeUndefined();
    expect(venueLabel({ name: "Lisbon", city: "Lisbon" })).toBe("Lisbon");
  });
});
