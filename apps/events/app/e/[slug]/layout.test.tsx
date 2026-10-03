// v24: /e/<unknown> answers HTTP 404. The page's own notFound() runs inside its loading boundary (the skeleton has
// already been sent with a 200), so the check lives in the segment layout, above that boundary.
import "../../../src/testing/b4";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { queryable } from "@didit-events/core/db/tx";
import { expect, it, vi } from "vitest";
import { databaseSuite } from "../../../src/testing/b4";
import { render } from "../../../src/testing/react-cache";

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("NEXT_REDIRECT;" + url); }, notFound: () => { throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }); } }));
const { default: EventLayout } = await import("./layout");
const { eventExists } = await import("./data");

const state = databaseSuite();
const layout = (slug: string) => render(() => EventLayout({ children: "page", params: Promise.resolve({ slug }) }));

it("an unknown slug and a draft are notFound() from the layout; a published event renders its page", async () => {
  expect(await layout("arbitrary")).toBe("page");
  await expect(layout("nope")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  await queryable(state.db).query("update events set status='draft' where id=$1", [state.eventId]);
  await expect(layout("arbitrary")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  expect(await render(() => eventExists("arbitrary"))).toBe(false);
});

it("the layout sits above the page's loading boundary, and the segment above it shows the event not-found page", () => {
  const at = (file: string) => existsSync(fileURLToPath(new URL(file, import.meta.url)));
  // A loading.tsx at app/e or app would put the layout inside a Suspense boundary again (a 200 with a skeleton).
  expect([at("./loading.tsx"), at("../loading.tsx"), at("../../loading.tsx")]).toEqual([true, false, false]);
  expect(at("../not-found.tsx")).toBe(true);
});
