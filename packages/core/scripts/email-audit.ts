// pnpm email:audit [--offline] [--app-url=URL] [--assets-url=URL]
// Renders every email (rich + minimal data, bound like a real send) to tmp/email-audit/, checks each one
// (notifications/email-audit.ts) and HEAD-checks every image URL. --offline (or EMAIL_AUDIT_OFFLINE=1) skips the
// network. Exit 1 when any template has a problem or an image does not load.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { auditEmails } from "../src/notifications/email-audit.ts";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const offline = process.argv.includes("--offline") || process.env.EMAIL_AUDIT_OFFLINE === "1";
const appUrl = arg("app-url") ?? "http://localhost:3332";
const assetsOrigin = arg("assets-url") ?? process.env.EMAIL_ASSETS_URL;

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = join(root, "tmp/email-audit");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const rows = auditEmails({ appUrl, ...(assetsOrigin ? { assetsOrigin } : {}) });
for (const r of rows) {
  const base = join(out, `${r.code}-${r.fixture}`);
  writeFileSync(`${base}.html`, r.rendered.html);
  writeFileSync(`${base}.txt`, `Subject: ${r.subject}\nPreheader: ${r.rendered.preheader}\n\n${r.rendered.text}`);
  if (r.attachment) writeFileSync(`${base}.${r.attachment.filename}`, r.attachment.ics);
}

/** HEAD each unique image once (GET when a server refuses HEAD). */
async function check(url: string): Promise<string> {
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10_000) });
    if (res.status === 405) res = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(10_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) return `HTTP ${res.status}`;
    if (!/^(image\/|font\/|application\/font|application\/octet-stream)/.test(type)) return `HTTP ${res.status} but ${type || "no content-type"}`;
    return "ok";
  } catch (error) {
    return `unreachable (${(error as Error).name})`;
  }
}
const urls = [...new Set(rows.flatMap((r) => r.images))].sort();
const status = new Map<string, string>();
if (offline) for (const u of urls) status.set(u, "skipped (offline)");
else await Promise.all(urls.map(async (u) => status.set(u, await check(u))));
const brokenImage = (u: string) => !["ok", "skipped (offline)"].includes(status.get(u)!);

const lines = [
  `# Email audit · ${new Date().toISOString()}`,
  "",
  `APP_URL ${appUrl} · assets ${assetsOrigin ?? "(default)"} · image check ${offline ? "offline" : "HEAD"}`,
  "",
  "| Code | Data | Subject (chars) | Images | Calendar | Result |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) => {
    const broken = r.images.filter(brokenImage);
    const problems = [...r.problems, ...broken.map((u) => `image ${status.get(u)}: ${u}`)];
    const cal = r.attachment ? `${r.attachment.filename} (${r.attachment.method})` : "–";
    return `| ${r.code} | ${r.fixture} | ${r.subject.replace(/\|/g, "\\|")} (${r.subject.length}) | ${r.images.length} | ${cal} | ${problems.length ? problems.join("; ").replace(/\|/g, "\\|") : "ok"} |`;
  }),
  "",
  "| Image | Status |",
  "|---|---|",
  ...urls.map((u) => `| ${u} | ${status.get(u)} |`),
  "",
];
const report = lines.join("\n");
writeFileSync(join(out, "report.md"), report);
console.log(report);

const failing = rows.filter((r) => r.problems.length || r.images.some(brokenImage));
console.log(`${rows.length} renders (${rows.length / 2} templates × rich/minimal), ${failing.length} with problems, ${urls.length} image URLs. Files: ${relative(process.cwd(), out)}/`);
process.exit(failing.length ? 1 : 0);
