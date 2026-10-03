import { framesEnabled } from "@didit-events/ui/frames/guard";

/**
 * `?preview=<frame code>` on a real route shows that design state with fixtures, so every state is reachable in the
 * running app before the backend lands. Only where the frame gallery is on (dev, test, FRAMES=1).
 */
export function previewCode(searchParams: Record<string, string | string[] | undefined>): string | undefined {
  const p = searchParams.preview;
  return typeof p === "string" && framesEnabled() ? p : undefined;
}
