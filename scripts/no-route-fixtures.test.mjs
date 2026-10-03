import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
const root = resolve(import.meta.dirname, '..');
const source = /\.[cm]?[jt]sx?$/;
const fixture = /(?:^|\/)(?:[^/]*fixtures?|stub|testing-[^/]+|testing)(?:\/|\.|$)/;
const compiler = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, allowJs: true, jsx: ts.JsxEmit.ReactJSX };
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
}
function imports(file) {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const paths = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly || ts.isExportDeclaration(node) && !node.isTypeOnly) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (!(!node.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(e => e.isTypeOnly))) paths.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(tree) === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) paths.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return paths;
}
function dependency(specifier, from) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@didit-events/')) return null;
  const resolved = ts.resolveModuleName(specifier, from, compiler, ts.sys).resolvedModule?.resolvedFileName;
  // Workspace symlinks resolve to source; declaration-only and non-code imports cannot execute fixtures.
  return resolved && source.test(resolved) && !resolved.endsWith('.d.ts') && existsSync(resolved) ? resolve(resolved) : null;
}
it('every real route and its runtime dependencies are free of fixtures, including lazy imports', () => {
  const roots = ['events'].flatMap(app => files(join(root, 'apps', app, 'app')))
    .filter(file => source.test(file) && !/\/(?:%5Fframes|_frames)\//i.test(file) && !/\.test\./.test(file));
  const violations = new Set(), seen = new Set();
  expect(roots.length).toBeGreaterThan(100);
  for (const entry of roots) {
    function walk(file, chain) {
      if (seen.has(file)) return; seen.add(file);
      if (fixture.test(relative(root, file))) { violations.add(chain.map(p => relative(root, p)).join(' -> ')); return; }
      for (const specifier of imports(file)) {
        // JSON assets and package subpaths are violations too, even if they have no source AST.
        if (fixture.test(specifier)) { violations.add(`${chain.map(p => relative(root, p)).join(' -> ')} -> ${specifier}`); continue; }
        const next = dependency(specifier, file); if (next) walk(next, [...chain, next]);
      }
    }
    walk(entry, [entry]);
  }
  expect([...violations], 'Only /_frames and tests may load fixtures').toEqual([]);
});
