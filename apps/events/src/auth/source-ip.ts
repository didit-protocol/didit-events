import { isIP } from "node:net";
import { PolicyError } from "@didit-events/core/http/policy";

export function sourceIpFromHeaders(headers: Headers) {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1), chain = (headers.get("x-forwarded-for") ?? "").split(",").map(s => s.trim());
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 10) throw new PolicyError(503, "InvalidProxyHops");
  const ip = hops > 0 ? chain.at(-hops) : undefined;
  return ip && isIP(ip) ? ip : "unknown";
}
