import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventPage } from "./components/EventPage";
import { AI_ERA } from "./fixtures";
import { isGoogleMapsUrl, mapEmbedSrc, mapsOpenHref, venueCoords } from "./map";

const noop = async () => {};
const page = (venue = AI_ERA.venue) =>
  renderToStaticMarkup(<EventPage event={{ ...AI_ERA, venue }} related={[]} viewer={null} card={{ kind: "signed_out" }} now={new Date("2026-09-30T12:00:00Z")} actions={{ verify: noop, subscribe: noop }} />).replace(/&amp;/g, "&");

describe("event page map: exact pin, one Google Maps control", () => {
  it("pins the picked coordinates, not a text search", () => {
    expect(mapEmbedSrc({ name: "Didit HQ", address: "Carrer de Pallars 99", lat: 41.398571234, lng: 2.19399 })).toBe("https://maps.google.com/maps?q=loc%3A41.398571%2C2.19399&z=16&hl=en&output=embed");
    expect(mapEmbedSrc({ name: "Didit HQ", address: "Carrer de Pallars 99" })).toContain("q=Carrer%20de%20Pallars%2099&") // street address alone pins reliably;
    expect(mapEmbedSrc({ name: " ", address: "" })).toBeNull();
    expect(venueCoords({ lat: 91, lng: 0 })).toBeNull();
    expect(venueCoords({ lat: Number.NaN, lng: 2 })).toBeNull();
  });

  it("opens exactly the picked place by ID, else the saved https Maps URL, else a search", () => {
    const v = { name: "Didit HQ", address: "Carrer de Pallars 99", mapsUrl: "https://maps.google.com/?cid=1", lat: 41.39857, lng: 2.19399 };
    expect(mapsOpenHref({ ...v, placeId: "ChIJ123" })).toBe("https://www.google.com/maps/search/?api=1&query=41.39857%2C2.19399&query_place_id=ChIJ123");
    expect(mapsOpenHref(v)).toBe("https://maps.google.com/?cid=1");
    expect(mapsOpenHref({ ...v, mapsUrl: "javascript:alert(1)" })).toBe("https://www.google.com/maps/search/?api=1&query=41.39857%2C2.19399");
  });

  it("a saved Maps URL is followed only on Google Maps hosts; anything else falls back to the search", () => {
    const v = { name: "Didit HQ", address: "Carrer de Pallars 99", lat: 41.39857, lng: 2.19399 };
    const search = "https://www.google.com/maps/search/?api=1&query=41.39857%2C2.19399";
    for (const ok of ["https://maps.google.com/?cid=1", "https://www.google.com/maps/place/Didit", "https://www.google.com/maps", "https://goo.gl/maps/abc", "https://maps.app.goo.gl/xyz", "https://MAPS.GOOGLE.COM/?q=x"]) {
      expect(isGoogleMapsUrl(ok), ok).toBe(true);
      expect(mapsOpenHref({ ...v, mapsUrl: ok }), ok).toBe(ok);
    }
    for (const bad of [
      "https://evil.example/maps",
      "https://www.google.com/search?q=x",
      "https://www.google.com/mapsevil",
      "https://goo.gl/abc",
      "https://maps.google.com.evil.example/",
      "https://evil.example/?u=https://maps.google.com",
      "https://user@maps.google.com/",
      "https://maps.google.com:8443/",
      "http://maps.google.com/?cid=1",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isGoogleMapsUrl(bad), bad).toBe(false);
      expect(mapsOpenHref({ ...v, mapsUrl: bad }), bad).toBe(search);
    }
  });

  it("desktop and mobile layouts: an interactive Google Maps embed (zoom, drag), no overlay link", () => {
    const html = page();
    // Round 3: the embed mounts on the client in the displayed layout only; the server HTML carries it as the
    // no-JavaScript fallback of each layout (inert while scripting is on).
    expect(html.split("<noscript><iframe").length - 1).toBe(2);
    expect(html.replace(/<noscript>.*?<\/noscript>/g, "")).not.toContain("<iframe");
    expect(html).not.toContain("data-maps-control"); // the embed is the control
    expect(html).not.toContain('tabindex="-1"');
    expect(html).not.toContain('aria-hidden="true"><iframe');
    expect(html).toMatch(/<iframe[^>]*allowFullScreen/i);
    expect(html).toContain("q=loc%3A41.39857%2C2.19399");
    expect(html).not.toContain("(opens a map)");
    // The venue name in the header scrolls to the map instead of being a second external maps link.
    expect(html).toContain('href="#location"');
    expect(html).toContain('href="#location-m"');
  });
});
