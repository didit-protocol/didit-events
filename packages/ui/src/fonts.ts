import localFont from "next/font/local";

/** Inter variable (upright + italic), latin + latin-ext subset, full 100–900 weight axis. */
export const inter = localFont({
  src: [
    { path: "../fonts/Inter-Variable.woff2", style: "normal", weight: "100 900" },
    { path: "../fonts/Inter-Italic-Variable.woff2", style: "italic", weight: "100 900" },
  ],
  variable: "--font-inter",
  display: "swap",
});
