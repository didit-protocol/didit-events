#!/usr/bin/env node
// First-load JS report for every app route: reads each app's `.next` build output (run `pnpm build` first), prints
// the gzip size per route and exits 1 when a route exceeds its budget in scripts/size-budgets.json.
//
// First-load JS of a page = the root main chunks (build-manifest `rootMainFiles`) plus every entry chunk of the
// page and its layouts (`entryJSFiles` in the page's client-reference manifest). Polyfills load only in legacy
// browsers (noModule) and are left out, like Next.js' own report did.
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const budgets = JSON.parse(readFileSync(join(root, "scripts/size-budgets.json"), "utf8"));
const INTERNAL = new Set(["/_not-found", "/_global-error"]);
const EXCLUDED = budgets.exclude ?? [];
const excluded = (route) => EXCLUDED.some((p) => route === p || route.startsWith(`${p}/`));
const kb = (bytes) => (bytes / 1024).toFixed(1);

const gzipCache = new Map();
function gzipSize(file) {
  if (!gzipCache.has(file)) gzipCache.set(file, gzipSync(readFileSync(file), { level: 9 }).length);
  return gzipCache.get(file);
}

function readClientManifest(file) {
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  runInNewContext(readFileSync(file, "utf8"), sandbox);
  const [manifest] = Object.values(sandbox.__RSC_MANIFEST ?? {});
  if (!manifest) throw new Error(`no __RSC_MANIFEST entry in ${relative(root, file)}`);
  return manifest;
}

function budgetFor(app, route) {
  const config = budgets.apps[app];
  const match = Object.keys(config.routes ?? {})
    .sort((a, b) => b.length - a.length)
    // "/" budgets the home route only; it is not a prefix of every route.
    .find((prefix) => route === prefix || (prefix !== "/" && route.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)));
  return match ? config.routes[match] : config.default;
}

let failed = false;
for (const app of Object.keys(budgets.apps)) {
  const next = join(root, "apps", app, ".next");
  const routesFile = join(next, "app-path-routes-manifest.json");
  if (!existsSync(routesFile)) {
    console.error(`✗ ${app}: ${relative(root, routesFile)} not found; run \`pnpm build\` first`);
    failed = true;
    continue;
  }
  const { rootMainFiles = [] } = JSON.parse(readFileSync(join(next, "build-manifest.json"), "utf8"));
  const routes = JSON.parse(readFileSync(routesFile, "utf8"));

  console.log(`\n${app}  (first-load JS, gzip)`);
  const rows = [];
  for (const [entry, route] of Object.entries(routes)) {
    if (!entry.endsWith("/page")) continue; // route handlers ship no client JS
    const manifestFile = join(next, "server", "app", `${entry}_client-reference-manifest.js`);
    const chunks = new Set(rootMainFiles);
    if (existsSync(manifestFile)) {
      for (const files of Object.values(readClientManifest(manifestFile).entryJSFiles ?? {})) {
        for (const f of files) chunks.add(f.replace(/^\/?_next\//, ""));
      }
    }
    const bytes = [...chunks].reduce((sum, f) => sum + gzipSize(join(next, f)), 0);
    const budget = INTERNAL.has(route) || excluded(route) ? null : budgetFor(app, route);
    const over = budget !== null && bytes > budget * 1024;
    if (over) failed = true;
    rows.push({ route, bytes, budget, over });
  }
  rows.sort((a, b) => a.route.localeCompare(b.route));
  const width = Math.max(...rows.map((r) => r.route.length), 5);
  for (const { route, bytes, budget, over } of rows) {
    const limit = budget === null ? "(not budgeted)" : `/ ${budget} KB`;
    console.log(`  ${over ? "✗" : "✓"} ${route.padEnd(width)}  ${kb(bytes).padStart(6)} KB  ${limit}`);
  }
}

if (failed) {
  console.error("\nsize: FAILED (a route is over budget or a build is missing)");
  process.exit(1);
}
console.log("\nsize: all routes within budget");
