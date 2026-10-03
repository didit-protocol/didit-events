import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { get } from "node:https";
import { CALENDAR_IMAGE_MAX_BYTES, CALENDAR_IMAGE_TYPES } from "@didit-events/core/calendar";

export class ImageDownloadError extends Error {}
const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) blocked.addSubnet(address, prefix);
const globalV6 = new BlockList(); globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6"); blocked.addSubnet("2001:db8::", 32, "ipv6"); blocked.addSubnet("2002::", 16, "ipv6");
export function publicImageAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address) : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

/** DNS is checked and pinned to the connection, including the TLS server name. Redirects never get followed. */
export async function downloadImage(value: string): Promise<Uint8Array> {
  const url = new URL(value), hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new ImageDownloadError("Use a public HTTPS image URL on port 443, without credentials.");
  const signal = AbortSignal.timeout(10_000);
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await new Promise<LookupAddress[]>((resolve, reject) => {
    const abort = () => reject(new ImageDownloadError("Image DNS lookup timed out."));
    signal.addEventListener("abort", abort, { once: true });
    lookup(hostname, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  if (!addresses.length || addresses.some(a => !publicImageAddress(a.address))) throw new ImageDownloadError("Image URLs must resolve to public internet addresses.");
  const target = addresses[0]!;
  return new Promise((resolve, reject) => {
    const request = get(url, {
      agent: false, signal,
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [target]); else callback(null, target.address, target.family);
      },
    }, response => {
      const fail = (message: string) => { response.destroy(); reject(new ImageDownloadError(message)); };
      if (response.statusCode !== 200) return fail("Image download failed. Use a direct image URL without redirects.");
      const type = response.headers["content-type"]?.split(";")[0]?.trim();
      if (!CALENDAR_IMAGE_TYPES.some(t => t === type)) return fail("Use a JPG, PNG or WebP image.");
      if (Number(response.headers["content-length"]) > CALENDAR_IMAGE_MAX_BYTES) return fail("Use an image under 5 MB.");
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > CALENDAR_IMAGE_MAX_BYTES) { fail("Use an image under 5 MB."); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      response.on("error", () => reject(new ImageDownloadError("Image download did not complete.")));
    });
    request.on("error", () => reject(new ImageDownloadError("Image download failed or timed out.")));
  });
}

/** Decode bounded canonical base64 before the shared image decoder validates content. */
export function decodeEventCover(value: string): Uint8Array {
  const raw = value.replace(/^data:image\/(?:png|jpeg);base64,/, "");
  if (!raw || raw.length > 4*Math.ceil(5*1024*1024/3) || raw.length % 4 !== 0) throw new ImageDownloadError("Use base64 PNG or JPEG up to 5 MB.");
  const bytes = Buffer.from(raw,"base64");
  if (!bytes.length || bytes.length>5*1024*1024 || bytes.toString("base64") !== raw) throw new ImageDownloadError("Use an image under 5 MB.");
  return bytes;
}
