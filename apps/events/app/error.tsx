"use client";

import { CONTACT_EMAIL } from "../src/config";

import { reportBoundaryError } from "../src/system/report-error";

/**
 * Any page without its own error boundary. Deliberately dependency-free (plain markup, inline styles): a root boundary is
 * shipped with every route, and the UI kit would add ~4 KB to each. A newer deploy (stale server action or chunk) asks
 * for a reload instead of a retry.
 */
const STALE = /Failed to find Server Action|older or newer deployment|ChunkLoadError|Loading chunk [\w-]+ failed|Failed to load chunk/i;
const pill = { display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 20px", borderRadius: 999, border: "1px solid #e5e5e5", background: "#fff", color: "#1a1a1a", font: "inherit", fontWeight: 500, textDecoration: "none", cursor: "pointer" } as const;

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  reportBoundaryError(error);
  const stale = STALE.test(`${error?.name} ${error?.message}`);
  return (
    <main style={{ width: "min(560px, calc(100% - 32px))", margin: "64px auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 24, fontWeight: 500, margin: "0 0 8px" }}>{stale ? "A new version is available" : "Something went wrong"}</h1>
      <p style={{ color: "#555", margin: "0 0 24px" }}>{stale ? "Reload the page to continue." : `Try again, or write to ${CONTACT_EMAIL} if it keeps happening.`}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
        {stale ? <button type="button" style={pill} onClick={() => location.reload()}>Reload</button> : <button type="button" style={pill} onClick={reset}>Try again</button>}
        <a href="/events" style={pill}>Back to events</a>
      </div>
    </main>
  );
}
