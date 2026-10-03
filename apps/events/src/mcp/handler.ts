import { z } from "zod";
import type { Db } from "@didit-events/core/db";
import { requireStaffByToken } from "@didit-events/core/identity/sessions";
import { IdentityError } from "@didit-events/core/identity/shared";
import { consume } from "@didit-events/core/counters";
import { PolicyError } from "@didit-events/core/http/policy";
import { AdmissionError } from "@didit-events/core/admission/shared";
import { CalendarImageError } from "@didit-events/core/calendar";
import { ModelError } from "@didit-events/core/domain/model-error";
import { AssetError } from "@didit-events/core/content/event-assets";
import { ImageDownloadError } from "./images";
import { schemas, toolDefinitions, type ToolName } from "./schemas";
import { createTools, readOnlyTools } from "./tools";

const versions = ["2025-06-18", "2025-03-26"];
const rpc = z.strictObject({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number().finite()]).optional(), method: z.string(), params: z.record(z.string(), z.unknown()).optional() });
const headers = { "Cache-Control": "no-store", "MCP-Protocol-Version": versions[0]! };
function error(id: string | number | null, code: number, message: string, status = 200, extra: Record<string, string> = {}) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers: { ...headers, ...extra } });
}
export function safeError(cause: unknown) {
  if (cause instanceof z.ZodError) return `Invalid input: ${cause.issues.map(i => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ")}`;
  if (cause instanceof ModelError || cause instanceof AssetError || cause instanceof IdentityError || cause instanceof PolicyError || cause instanceof AdmissionError || cause instanceof CalendarImageError || cause instanceof ImageDownloadError) return cause.message;
  return "The action could not be completed. Check the input and server availability.";
}
async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 7 * 1024 * 1024) throw new PolicyError(413, "Request exceeds 7 MB.");
  const reader = request.body?.getReader(); if (!reader) return "";
  let size = 0; const chunks: Uint8Array[] = [];
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 7 * 1024 * 1024) throw new PolicyError(413, "Request exceeds 7 MB."); chunks.push(value); } }
  finally { await reader.cancel(); reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

/** Stateless Streamable HTTP: a single JSON response, no sessions and no SSE transport. */
export function createMcpHandler(options: { db?: Db; changed?: () => void } = {}) {
  const tools = createTools(options.db);
  return async (request: Request): Promise<Response> => {
    if (request.method === "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST, DELETE" } });
    if (request.headers.has("origin")) return error(null, -32000, "Browser Origin headers are not accepted.", 403);
    const bearer = /^Bearer (det_[A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization") ?? "");
    if (!bearer) return error(null, -32000, "A staff Bearer token is required. Cookies do not authenticate MCP requests.", 401, { "WWW-Authenticate": "Bearer" });
    let actor;
    try {
      actor = await requireStaffByToken(bearer[1]!, undefined, options.db);
      const rate = await consume(`mcp:${actor.apiTokenId}`, 120, 60, options.db);
      if (!rate.allowed) return error(null, -32000, "Token rate limit exceeded (120 requests/minute).", 429, { "Retry-After": String(Math.max(1, Math.ceil((rate.resetsAt.getTime() - Date.now()) / 1000))) });
    } catch (cause) { return error(null, -32000, safeError(cause), cause instanceof IdentityError ? cause.status : 503); }
    if (request.method === "DELETE") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST, DELETE" } });
    const version = request.headers.get("mcp-protocol-version");
    if (version && !versions.includes(version)) return error(null, -32600, "Unsupported MCP protocol version.", 400);
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return error(null, -32600, "Content-Type must be application/json.", 415);
    let body;
    try { body = JSON.parse(await readBody(request)); }
    catch (cause) { return error(null, cause instanceof PolicyError ? -32600 : -32700, cause instanceof PolicyError ? cause.message : "Invalid JSON.", cause instanceof PolicyError ? cause.status : 400); }
    if (Array.isArray(body)) return error(null, -32600, "JSON-RPC batches are not supported.", 400);
    const parsed = rpc.safeParse(body);
    if (!parsed.success) return error(null, -32600, "Invalid JSON-RPC 2.0 request.", 400);
    const { id, method, params } = parsed.data;
    const result = (value: unknown) => Response.json({ jsonrpc: "2.0", id, result: value }, { headers });
    if (method === "notifications/initialized" && id === undefined) return new Response(null, { status: 202, headers });
    if (id === undefined) return error(null, -32600, "This method requires a request ID.", 400);
    if (method === "initialize") {
      const init = z.object({ protocolVersion: z.string(), capabilities: z.object({}).passthrough(), clientInfo: z.object({ name: z.string(), version: z.string() }).passthrough() }).safeParse(params);
      if (!init.success) return error(id, -32602, "initialize requires protocolVersion, capabilities and clientInfo.");
      return result({ protocolVersion: versions.includes(init.data.protocolVersion) ? init.data.protocolVersion : versions[0], capabilities: { tools: {} }, serverInfo: { name: "didit-events", version: "1.0.0" } });
    }
    if (method === "ping") return result({});
    if (method === "tools/list") return result({ tools: toolDefinitions() });
    if (method !== "tools/call") return error(id, -32601, "Method not found.");
    const call = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() }).safeParse(params);
    if (!call.success) return error(id, -32602, "tools/call requires a name and an arguments object.");
    if (!Object.hasOwn(schemas, call.data.name)) return error(id, -32602, "Unknown tool.");
    const name = call.data.name as ToolName;
    try {
      const value = await tools.call(name, call.data.arguments ?? {}, actor);
      if (!readOnlyTools.has(name)) options.changed?.();
      const structuredContent = value && typeof value === "object" && !Array.isArray(value) ? value : { result: value ?? null };
      return result({ content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent });
    } catch (cause) {
      const structuredContent = { error: safeError(cause) };
      return result({ content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent, isError: true });
    }
  };
}
