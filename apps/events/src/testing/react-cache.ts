import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { dirname,join } from "node:path";
import { vi } from "vitest";
import type * as React from "react";

/**
 * React's own server `cache` for loader tests. Vitest resolves "react" to the default build, whose `cache` is a plain
 * pass-through, so "once per render" could never be observed. This loads the react-server build (the one server
 * components run on) and gives it what a Flight render gives it: one cache store per render, none outside a render.
 * Import this file before the loaders under test.
 */
type Dispatcher = { getCacheForType<T>(create: () => T): T; cacheSignal(): null; getOwner(): null };
type ServerReact = { cache: typeof React.cache; __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { A: Dispatcher | null } };
const load = createRequire(import.meta.url);
const server = load(join(dirname(load.resolve("react/package.json")), "cjs/react.react-server.development.js")) as ServerReact;
const renders = new AsyncLocalStorage<Map<() => unknown, unknown>>();
server.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A = {
  // Outside a render (server action, route handler) every call gets an empty store: nothing is memoized, as in Next.
  getCacheForType<T>(create: () => T): T {
    const store = renders.getStore(); if (!store) return create();
    if (!store.has(create)) store.set(create, create());
    return store.get(create) as T;
  },
  cacheSignal: () => null, getOwner: () => null,
};
vi.mock("react", async original => ({ ...(await original<typeof React>()), cache: server.cache }));

/** One server render: everything `work` awaits (generateMetadata, the page, its loaders) shares one React cache. */
export const render = <T>(work: () => Promise<T>): Promise<T> => renders.run(new Map(), work);
