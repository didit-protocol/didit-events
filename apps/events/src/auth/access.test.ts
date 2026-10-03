import { globSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isEventCapability, isGlobalCapability } from "@didit-events/core/access/capabilities";
import { schemas, toolCapabilities } from "../mcp/schemas";

/*
 * Every admin entrypoint names its capability (the single source of truth is @didit-events/core/access/capabilities):
 * pages, server actions, data loaders and API routes, plus the door API. A new route without one fails here.
 */
const app = new URL("../../app/", import.meta.url);
const files = (pattern: string) => globSync(pattern, { cwd: app }).sort();
const ast = (file: string) => ts.createSourceFile(file, readFileSync(new URL(file, app), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Helper → index of its capability argument. `doorRequest` / `doorPageSession` authenticate a door session, which is door.operate. */
const HELPERS: Record<string, number | "door.operate" | "admin.enter"> = {
  requireEventAccess: 1, eventAccess: 1, findEventAccess: 1, routeEventAccess: 2, eventMutation: 2,
  requireGlobalAccess: 0, requireStaffAccess: 0, routeGlobalAccess: 1, globalMutation: 1,
  doorRequest: "door.operate", doorPageSession: "door.operate", adminPage: "admin.enter", requireStaff: "admin.enter", adminViewer: "admin.enter",
};
const literals = (node: ts.Expression | undefined): string[] | null => {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) { const a = literals(node.whenTrue), b = literals(node.whenFalse); return a && b ? [...a, ...b] : null; }
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  if (ts.isIdentifier(node)) return [`<${node.text}>`];
  return null;
};
/** Capabilities a function body declares through the helpers (unresolvable arguments come back as "<name>"). */
function declared(node: ts.Node, out: string[] = []): string[] {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && Object.hasOwn(HELPERS, node.expression.text)) {
    const at = HELPERS[node.expression.text]!;
    out.push(...(typeof at === "number" ? literals(node.arguments[at]) ?? ["<dynamic>"] : [at]));
  }
  node.forEachChild(child => void declared(child, out));
  return out;
}
const exported = (file: string) => ast(file).statements.filter(ts.isFunctionDeclaration).filter(f => f.body && f.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && (f.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || /page\.tsx$|route\.ts$/.test(file)));

describe("every admin entrypoint declares a capability", () => {
  const PUBLIC = new Set(["admin/login/page.tsx", "admin/forbidden/page.tsx", "admin/login/actions.ts", "admin/forbidden/data.ts"]);
  const entrypoints = [
    ...files("admin/**/{page.tsx,route.ts,actions.ts,data.ts}"),
    ...files("api/admin/**/route.ts"),
    ...files("api/door/**/route.ts"),
  ].filter(f => !PUBLIC.has(f));

  it("finds the admin surface (pages, actions, data, API, door)", () => {
    expect(entrypoints.length).toBeGreaterThan(50);
    for (const needle of ["admin/(door)/events/[id]/door/kiosk/page.tsx", "admin/(events)/events/[id]/(tabs)/door/page.tsx", "admin/(events)/events/[id]/(tabs)/team/actions.ts", "api/door/[id]/scan/route.ts", "api/door/[id]/start/route.ts"]) expect(entrypoints).toContain(needle);
    // The localhost kiosk is gone: no pairing or device API anywhere in the app.
    expect(files("**/kiosks/**")).toEqual([]);
    expect(files("api/access/**")).toEqual([]);
  });

  it.each(entrypoints.map(f => [f]))("%s", file => {
    const functions = exported(file);
    expect(functions.length, file).toBeGreaterThan(0);
    for (const fn of functions) {
      const caps = declared(fn.body!);
      const where = `${file}: ${fn.name?.text ?? "default"}`;
      // Shared chrome helpers in admin/data.ts receive an authorized viewer.
      if (file === "admin/data.ts" && fn.name?.text === "adminUser") continue;
      expect(caps.length, `${where} declares no capability`).toBeGreaterThan(0);
      for (const cap of caps) expect(isEventCapability(cap) || isGlobalCapability(cap) || cap === "door.operate", `${where}: ${cap}`).toBe(true);
    }
  });

  it("only the guards in src/auth/access.ts read the admin session for authorization", () => {
    for (const file of entrypoints) {
      const source = readFileSync(new URL(file, app), "utf8");
      expect(source, file).not.toMatch(/\bstaffPage\(|authService\.requireStaff|identity\.auth\.requireStaff|staffRead\(|staffPrincipal\(|actionStaff\(/);
    }
  });
});

describe("MCP tools declare capabilities from the same matrix", () => {
  it("every tool has exactly one capability that exists", () => {
    expect(Object.keys(toolCapabilities).sort()).toEqual(Object.keys(schemas).sort());
    for (const [tool, cap] of Object.entries(toolCapabilities)) expect(isEventCapability(cap) || isGlobalCapability(cap), tool).toBe(true);
    expect(Object.keys(schemas).filter(t => t.startsWith("kiosk"))).toEqual([]);
    expect(Object.keys(schemas)).toEqual(expect.arrayContaining(["event_team_list", "event_team_add", "event_team_remove", "door_status"]));
  });
});
