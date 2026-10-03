import { describe, expect, it } from "vitest";
import { mapQuery, mapsLink } from "./b4-views";

describe("public event Maps link", () => {
  it("uses the picked place's Google Maps URL, else a Maps search for venue + address", () => {
    expect(mapsLink({ mapsUrl: "https://maps.google.com/?cid=4949212542133135882", venue: "Didit HQ", address: "Carrer de Pallars 99" })).toBe("https://maps.google.com/?cid=4949212542133135882");
    expect(mapsLink({ mapsUrl: null, venue: "Didit HQ", address: "Carrer de Pallars 99, 08018 Barcelona" })).toBe("https://www.google.com/maps/search/?api=1&query=Didit%20HQ%2C%20Carrer%20de%20Pallars%2099%2C%2008018%20Barcelona");
    expect(mapsLink({ mapsUrl: "javascript:alert(1)", venue: null, address: "Lisbon" })).toBe("https://www.google.com/maps/search/?api=1&query=Lisbon");
  });
});

describe("embedded map pin (mapQuery)", () => {
  it("pins the picked place's coordinates, else leaves the address text to the page", () => {
    expect(mapQuery({ lat: 41.4022782, lng: 2.1712846 })).toBe("loc:41.4022782,2.1712846");
    expect(mapQuery({ lat: 0, lng: 0 })).toBe("loc:0,0");
    expect(mapQuery({ lat: null, lng: null })).toBeUndefined();
    expect(mapQuery({})).toBeUndefined();
  });
});
