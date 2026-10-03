import type { MetadataRoute } from "next";

/** Web app manifest: the Didit mark for "Add to Home Screen" and installed tabs (icon.svg / favicon.ico cover the browser tab). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Didit Events",
    short_name: "Didit Events",
    start_url: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
  };
}
