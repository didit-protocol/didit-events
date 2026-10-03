#!/usr/bin/env node
// Self-hosts the MediaPipe face-detection assets under apps/events/public/mediapipe/ (committed, so the kiosk works
// offline and never calls a CDN). Run by hand after bumping @mediapipe/tasks-vision: `pnpm --filter
// @didit-events/events mediapipe:copy` (add `--force` to re-download the model). Not a postinstall hook.
//
// Copies the classic (non-ES-module) SIMD and no-SIMD wasm loaders, which is what
// `FilesetResolver.forVisionTasks(basePath)` picks between, and downloads the BlazeFace short-range model.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(appRoot, "public", "mediapipe");
const wasmOut = join(outDir, "wasm");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";
const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

const require = createRequire(join(appRoot, "package.json"));
const pkgDir = dirname(require.resolve("@mediapipe/tasks-vision"));

mkdirSync(wasmOut, { recursive: true });
for (const file of WASM_FILES) {
  copyFileSync(join(pkgDir, "wasm", file), join(wasmOut, file));
  console.log(`copied ${relative(appRoot, join(wasmOut, file))}`);
}

const modelOut = join(outDir, "blaze_face_short_range.tflite");
if (existsSync(modelOut) && !process.argv.includes("--force")) {
  console.log(`kept ${relative(appRoot, modelOut)} (use --force to re-download)`);
} else {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(modelOut, bytes);
  console.log(`downloaded ${relative(appRoot, modelOut)} (${bytes.length} B)`);
}
