import { renderSafeMarkdown } from "@didit-events/core/content/markdown";

/** The public page's description HTML for an editor preview; null when the source is not a string or over the limit. */
export function renderDescriptionPreview(source: unknown): string | null {
  if (typeof source !== "string") return null;
  try {
    return renderSafeMarkdown(source);
  } catch {
    return null;
  }
}
