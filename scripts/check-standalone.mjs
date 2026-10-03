// Fails when files read from disk at runtime are missing from the standalone bundle (outputFileTracingIncludes drift).
import { existsSync, readFileSync } from "node:fs";
const required = [
  "apps/events/.next/standalone/packages/ui/src/og/Inter-500.ttf",
  "apps/events/.next/standalone/packages/ui/src/assets/didit-horizontal-color.png",
];
const missing = required.filter((f) => !existsSync(f));
if (missing.length) {
  console.error("standalone bundle is missing runtime files:\n  " + missing.join("\n  "));
  process.exit(1);
}
console.log(`standalone ok (${required.length} runtime files present)`);

// The image must ship apps/events/public: without it every /email/* asset (logo in every email) 404s in production.
const dockerfile = readFileSync("Dockerfile", "utf8");
if (!/COPY[^\n]*\/app\/apps\/events\/public \.\/apps\/events\/public/.test(dockerfile)) {
  console.error("Dockerfile must COPY apps/events/public next to the standalone server");
  process.exit(1);
}
console.log("dockerfile ok (public/ copied into the image)");

const routes = JSON.parse(readFileSync("apps/events/.next/app-path-routes-manifest.json", "utf8"));
const admin = Object.entries(routes).filter(([, route]) => route === "/admin");
if (admin.length !== 1 || admin[0][0] !== "/admin/(events)/(list)/page") {
  console.error("expected exactly one A-02 /admin route", admin);
  process.exit(1);
}
console.log("admin route ok (one /admin route, owned by the events group)");
