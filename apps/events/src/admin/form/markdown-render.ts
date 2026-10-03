import { actionCsrf } from "../../auth/client";
import type { RenderMarkdown } from "./MarkdownEditor";

/** The editor's Preview renderer: the public page's sanitiser behind /api/admin/markdown/preview. Null on any failure. */
export function httpRenderMarkdown(eventId?: string): RenderMarkdown {
  const url = `/api/admin/markdown/preview${eventId ? `?event=${encodeURIComponent(eventId)}` : ""}`;
  return async (source) => {
    try {
      const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { accept: "application/json", "content-type": "application/json", "x-csrf": actionCsrf() }, body: JSON.stringify({ source }) });
      const body = (await res.json()) as { ok?: boolean; data?: { html?: unknown } };
      return res.ok && body.ok && typeof body.data?.html === "string" ? body.data.html : null;
    } catch {
      return null;
    }
  };
}
