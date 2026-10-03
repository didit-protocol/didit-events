import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { framesEnabled } from "@didit-events/ui/frames/guard";
// Imported up front: React picks its dev/prod JSX runtime from NODE_ENV at load time, and the guard reads the env
// per request, so stubbing NODE_ENV afterwards exercises the production check with the dev runtime loaded.
import frame from "./[code]/page";
import index from "./page";

const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
}));
vi.mock("next/navigation", () => ({ notFound }));

afterEach(() => {
  vi.unstubAllEnvs();
  notFound.mockClear();
});

describe("/_frames guard", () => {
  it.each([
    [{ NODE_ENV: "production" }, false],
    [{ NODE_ENV: "production", FRAMES: "0" }, false],
    [{ NODE_ENV: "production", FRAMES: "1" }, true],
    [{ NODE_ENV: "development" }, true],
    [{ NODE_ENV: "test" }, true],
  ])("framesEnabled(%o) = %s", (env, expected) => {
    expect(framesEnabled(env)).toBe(expected);
  });

  it("index and frame pages call notFound() in production without FRAMES=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRAMES", "");
    expect(() => index()).toThrow("404");
    await expect(frame({ params: Promise.resolve({ code: "C-00" }) })).rejects.toThrow("404");
    expect(notFound).toHaveBeenCalledTimes(2);
  });

  it("renders T-00 and C-00 when FRAMES=1 in production, and 404s unknown codes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRAMES", "1");
    for (const [code, label] of [
      ["T-00", "T-00 Tokens"],
      ["C-00", "C-00 Components"],
    ]) {
      const html = renderToStaticMarkup(await frame({ params: Promise.resolve({ code: code! }) }));
      expect(html).toContain(`data-screen-label="${label}"`);
    }
    await expect(frame({ params: Promise.resolve({ code: "Z-99" }) })).rejects.toThrow("404");
  });
});
