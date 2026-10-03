"use client";

import { Button } from "@didit-events/ui";

/**
 * After a deploy, a page rendered by the previous build posts server actions (and lazy chunks) the new build no longer
 * has: Next throws "Failed to find Server Action … older or newer deployment" or a ChunkLoadError. That is not a bug in
 * the user's input, so every error boundary shows a reload prompt instead of the generic error card.
 */
export function isStaleDeploy(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /Failed to find Server Action|older or newer deployment|ChunkLoadError|Loading chunk [\w-]+ failed|Failed to load chunk/i.test(text);
}

export function StaleDeployNotice() {
  return (
    <div role="alert" style={{ maxWidth: 560, margin: "48px auto", padding: "24px", border: "1px solid var(--border)", borderRadius: 16, background: "var(--white)", fontFamily: "var(--font-sans)" }}>
      <h2 style={{ margin: "0 0 8px", font: "500 20px/1.3 var(--font-sans)" }}>A new version of Didit Events is live</h2>
      <p style={{ margin: "0 0 16px", color: "var(--high)" }}>Reload the page to continue. Anything you typed in this form needs to be entered again.</p>
      <Button onClick={() => window.location.reload()}>Reload page</Button>
    </div>
  );
}
