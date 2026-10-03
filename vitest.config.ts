import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // next/dynamic renders nothing on a synchronous server render in tests: header tests get the real account menu.
    alias: [{ find: /^\.\/AccountMenuLazy$/, replacement: "./AccountMenu" }],
  },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs", "apps/*/{app,lib,src}/**/*.test.{ts,tsx}"],
    environment: "node",
    // DB suites each own Postgres pools and PGlite WASM; bound Docker connections and memory.
    maxWorkers: 3,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    css: { modules: { classNameStrategy: "non-scoped" } },
    // next.config enables authInterrupts (forbidden()); Next inlines this flag at build time, tests set it here.
    env: { __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS: "true", STAFF_EMAIL_DOMAIN: "didit.me", SEED_OWNER_EMAIL: "events.owner@didit.me", DIDIT_FACE_WORKFLOW_ID: "00000000-0000-4000-8000-00000000face" },
  },
});
