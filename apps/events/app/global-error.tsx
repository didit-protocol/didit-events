"use client";

import { CONTACT_EMAIL } from "../src/config";

import { reportBoundaryError } from "../src/system/report-error";

/** Last resort when the root layout itself fails: no app chrome is available, so plain markup and inline styles. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  reportBoundaryError(error);
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fff", color: "#1a1a1a", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
        <main style={{ width: "min(560px, calc(100% - 32px))", margin: "64px auto", textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 500, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ color: "#555", margin: "0 0 24px" }}>Try again, or write to {CONTACT_EMAIL} if it keeps happening.</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 20px", borderRadius: 999, border: "1px solid #ddd", background: "#fff", font: "inherit", cursor: "pointer" }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
