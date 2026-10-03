import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { FACE_WORKFLOW_ID } from "../domain/event-model.ts";
import { SESSION_CONFIG } from "../domain/workflow-plan.ts";
import type { DiditDecision,FaceMatch } from "./types.ts";

type Json = Record<string, unknown>;
const readFixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as Json;
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
/** A loopback-only Didit fixture server. All requests, including retries, are counted at the HTTP boundary. */
export async function fakeDiditServer(options: { beforeCheck?: () => Promise<void>; beforeSend?: () => Promise<void> } = {}) {
  const counts = { send: 0, check: 0, delete: 0 }, requests: Array<{ path: string; body: Json }> = [];
  const challenges = new Map<string, { id: string; sends: number; expired: boolean }>();
  let checkStatus = "Approved", sendStatus: string | undefined, mismatchedRequest = false, deletionStatus = 200;
  const sendFixture = readFixture("email-send"), checkFixture = readFixture("email-check"), deleteFixture = readFixture("session-delete");

  type ImageCase = { matches?: FaceMatch[]; liveness?: string; livenessStatus?: number; searchStatus?: number; warnings?: Json[] };
  const state = { matches: fixture("face-search").face_search.matches as FaceMatch[], liveness: "Approved", searchStatus: 200, warnings: [] as Json[],
    imageCases: new Map<string, ImageCase>(), images: [] as { path: string; sha256: string; bytes: number; saved: boolean }[],
    calls: { search: 0, liveness: 0 }, saved: 0, active: 0, maxActive: 0, beforeResponse: undefined as (() => Promise<void>) | undefined };
  const workflows=new Map<string,Json>();
  const destinations = new Map<string, Json>();
  const makeWorkflow=(input:Json,id:string= randomUUID())=>{const features=input.features as {feature:string;config:Json}[],nodes:Json={};features.forEach((f,i)=>{nodes[`step${i}`]={node_type:"feature",...f,next:i+1<features.length?`step${i+1}`:"done"};});nodes.done={node_type:"status",session_status:"Determine"};return {...SESSION_CONFIG,...input,features:features.map(f=>f.feature).join(","),uuid:randomUUID(),workflow_id:id,status:"published",is_archived:false,min_price:0.05,max_price:features.length*0.1,workflow_graph:{start_node:"step0",nodes}};};
  const faceWorkflow=makeWorkflow({workflow_label:"Didit Events · Selfie renewal",features:[{feature:"LIVENESS",config:{}}]},FACE_WORKFLOW_ID);workflows.set(String(faceWorkflow.uuid),faceWorkflow);
  const decisions = new Map<string, DiditDecision>();
  const urls = new Map<string, string>();
  const calls: Array<{ method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null }> = [];
  const control: { dropNextCreate: boolean; pageSize?: number; before?: (call: typeof calls[number]) => Promise<void>; listTransform?: (rows: Record<string, unknown>[], call: typeof calls[number]) => Record<string, unknown>[] | Promise<Record<string, unknown>[]> } = { dropNextCreate: false };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost"), chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks), raw = bytes.toString("utf8");
      const biometric = req.method === "POST" && ["/v3/face-search/", "/v3/passive-liveness/"].includes(url.pathname);
      const call = { method: req.method!, path: url.pathname, query: url.searchParams, body: raw && !biometric ? JSON.parse(raw) as Record<string, unknown> : null };
      calls.push(call);
      await control.before?.(call);
      res.setHeader("Content-Type", "application/json");
      const send = (value: unknown) => res.end(JSON.stringify(value));
      if (call.path === "/v3/webhook/destinations/") {
        if (call.method === "GET") { send([...destinations.values()].map(({secret_shared_key: _secret, ...row}) => row)); return; }
        if (call.method === "POST") { const row = {uuid:randomUUID(),enabled:true,webhook_version:"v3",subscribed_events:[],...call.body,secret_shared_key:randomUUID()};destinations.set(row.uuid,row);res.statusCode=201;send(row);return; }
      }
      const destination = /^\/v3\/webhook\/destinations\/([^/]+)\/$/.exec(call.path);
      if (destination) {
        const row=destinations.get(destination[1]!);
        if (!row) {res.statusCode=404;send({detail:"Not found"});return;}
        if(call.method==="DELETE"){destinations.delete(destination[1]!);res.writeHead(204).end();return;}
        if(call.method==="PATCH")Object.assign(row,call.body);
        send(row);return;
      }
      if(call.path==="/v3/workflows/" && call.method==="GET"){send({count:workflows.size,next:null,previous:null,results:[...workflows.values()]});return;}
      if(call.path==="/v3/workflows/" && call.method==="POST"){
        if (String(call.body?.workflow_label).length > 50) {res.statusCode=400;send({workflow_label:["Ensure this field has no more than 50 characters."]});return;}
        const w=makeWorkflow(call.body!);workflows.set(String(w.uuid),w);send(w);return;
      }
      const wf=/^\/v3\/workflows\/([^/]+)\/$/.exec(call.path);
      if(wf && call.method==="GET"){const w=workflows.get(wf[1]!);if(!w)res.statusCode=404;send(w??{detail:"Not found"});return;}
      if (biometric) {
        const search = url.pathname === "/v3/face-search/";
        const boundary = String(req.headers["content-type"]).match(/boundary=(.+)$/)?.[1];
        const marker = bytes.indexOf(Buffer.from('name="user_image";'));
        const start = marker < 0 ? -1 : bytes.indexOf(Buffer.from("\r\n\r\n"), marker) + 4;
        const end = start < 0 ? -1 : bytes.indexOf(Buffer.from(`\r\n--${boundary}`), start);
        const image = start >= 4 && end > start ? bytes.subarray(start, end) : Buffer.alloc(0);
        const sha256 = createHash("sha256").update(image).digest("hex");
        const imageCase = state.imageCases.get(sha256);
        state.images.push({path:url.pathname,sha256,bytes:image.length,saved:!raw.includes('name="save_api_request"\r\n\r\nfalse')});
        if (state.imageCases.size && !imageCase) { res.statusCode=422;send({detail:"Unknown journey JPEG"});return; }
        state.calls[search ? "search" : "liveness"]++;
        state.active++; state.maxActive = Math.max(state.maxActive, state.active);
        try {
          if (!raw.includes('name="save_api_request"\r\n\r\nfalse')) state.saved++;
          await state.beforeResponse?.();
          res.setHeader("content-type", "application/json");
          const searchStatus = imageCase?.searchStatus ?? state.searchStatus;
          if (!search && imageCase?.livenessStatus && imageCase.livenessStatus !== 200) {
            res.writeHead(imageCase.livenessStatus).end(JSON.stringify({detail:"No face detected"}));return;
          }
          if (search && searchStatus !== 200) {
            res.writeHead(searchStatus).end(JSON.stringify({ detail: searchStatus === 400 ? "No face detected" : "Unavailable" })); return;
          }
          const body = fixture(search ? "face-search" : "passive-liveness");
          if (search) { body.face_search.matches = imageCase?.matches ?? state.matches; body.face_search.total_matches = body.face_search.matches.length; body.face_search.warnings = imageCase?.warnings ?? state.warnings; }
          else body.liveness.status = imageCase?.liveness ?? state.liveness;
          res.end(JSON.stringify(body));
          return;
        } finally { state.active--; }
      }
      if (call.method === "POST" && call.path === "/v3/session/") {
        const input = call.body!;
        // Session creation is billable and is not implicitly idempotent by vendor email.
        const id = randomUUID();
        const decision: DiditDecision = { session_id: id, workflow_id: String(input.workflow_id), vendor_data: String(input.vendor_data), status: "Not Started", metadata:input.metadata as DiditDecision["metadata"],url:`https://verify.didit.me/session/${id}`,created_at: new Date().toISOString(), events: [] };
        decisions.set(id, decision); urls.set(id, `https://verify.didit.me/session/${id}`);
        if (control.dropNextCreate) { control.dropNextCreate = false; req.socket.destroy(); return; }
        send({ session_id: id, workflow_id: decision.workflow_id, vendor_data: decision.vendor_data, status: decision.status, url: urls.get(id) }); return;
      }
      const match = /^\/v3\/session\/([^/]+)\/decision\/$/.exec(call.path);
      if (call.method === "GET" && match) {
        const decision = decisions.get(match[1]!);
        if (!decision) { res.statusCode = 404; send({ detail: "Not found" }); } else send(decision);
        return;
      }
      if (call.method === "GET" && call.path === "/v3/sessions/") {
        let items: Record<string, unknown>[] = [...decisions.values()].filter(row => (!call.query.has("workflow_id") || row.workflow_id === call.query.get("workflow_id")) &&
          (!call.query.has("vendor_data") || row.vendor_data === call.query.get("vendor_data"))).map(row => ({ session_id: row.session_id, workflow_id: row.workflow_id, vendor_data: row.vendor_data, status: row.status, created_at: row.created_at, session_url: urls.get(row.session_id) ?? `https://verify.didit.me/session/${row.session_id}` }));
        items = await control.listTransform?.(items, call) ?? items;
        const offset = Number(call.query.get("offset") ?? 0), limit = Math.min(Number(call.query.get("limit") ?? 50), control.pageSize ?? 100);
        const results = items.slice(offset, offset + limit);
        send({ count: items.length, next: offset + limit < items.length ? `https://verification.didit.me/v3/sessions/?offset=${offset + limit}` : null, previous: null, results }); return;
      }
      const path = call.path, body = call.body ?? {};
      requests.push({ path, body });
      let out: Json;
      if (call.method === "POST" && path === "/v3/email/send/") {
        counts.send++; await options.beforeSend?.();
        const email = String(body.email), existing = challenges.get(email);
        const challenge = existing && existing.sends < 2 && !existing.expired ? existing : { id: randomUUID(), sends: 0, expired: false };
        challenge.sends++; challenges.set(email, challenge);
        out = { ...sendFixture, status: sendStatus ?? (challenge.sends === 2 ? "Retry" : "Success"), request_id: challenge.id };
      } else if (call.method === "POST" && path === "/v3/email/check/") {
        counts.check++; await options.beforeCheck?.();
        const c = challenges.get(String(body.email));
        const status = !c || c.expired ? "Expired or Not Found" : body.code !== "481903" ? "Declined" : checkStatus;
        out = { ...checkFixture, status, request_id: mismatchedRequest || !c ? randomUUID() : c.id, email: status === "Approved" ? { ...(checkFixture.email as Json), email: body.email,verified_at:new Date().toISOString() } : null };
        if (c && status === "Approved" && !mismatchedRequest) c.expired = true;
      } else if (call.method === "DELETE" && /^\/v3\/session\/[^/]+\/delete\/$/.test(path)) {
        counts.delete++;
        if (deletionStatus !== 200) { res.writeHead(deletionStatus); res.end(); return; }
        out = { ...deleteFixture, session_id: path.split("/")[3] };
        if ((out as Json).face_retention_outcome === "deleted") decisions.delete(String(path.split("/")[3]));
      } else { res.statusCode = 404; send({ detail: "Unknown fixture endpoint" }); return; }
      send(out);
    } catch { res.statusCode = 500; res.end('{"detail":"Fixture server error"}'); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const transport: typeof fetch = (input, init) => {
    const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (target.origin !== "https://verification.didit.me") throw new Error("UnexpectedFakeProviderOrigin");
    return fetch(`${origin}${target.pathname}${target.search}`, init);
  };
  const approved = (accountId: string, workflowId: string, overrides: Partial<DiditDecision> = {}): DiditDecision => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const decision: DiditDecision = { ...fixture("decision"), session_id: randomUUID(), workflow_id: workflowId, vendor_data: `acct_${accountId}`,
      created_at: new Date(Date.now() - 120_000).toISOString(),
      email_verifications: [{ status: "Approved", email: `${accountId}@example.test`, verified_at: at }],
      events: [{ event_type: "SESSION_STATUS_CHANGED", feature_step: null, created_at: at, details: { current_status: "Approved" } }], ...overrides };
    decisions.set(decision.session_id, decision);
    return decision;
  };
  return { state, workflows, origin, url: `${origin}/v3/`, base: origin, fetch: transport, decisions, calls, control, approved, counts, requests, challenges,
    setCheckStatus: (value: string) => { checkStatus = value; }, setSendStatus: (value?: string) => { sendStatus = value; },
    mismatchRequest: (value: boolean) => { mismatchedRequest = value; }, setDeletionStatus: (value: number) => { deletionStatus = value; },
    count: (method: string, path?: string) => calls.filter(call => call.method === method && (!path || call.path === path)).length,
    close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
