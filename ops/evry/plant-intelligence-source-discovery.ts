import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

const PAGE_SOURCE = "src/app/(dashboard)/phase/page.tsx";
const COMPONENT_ROOT = "src/components/phase-engine";
const ROUTE_ROOT = "src/app/(dashboard)/phase";

const normalize = (value: string) => value.split(path.sep).join("/");

function parsed(repoRoot: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    source,
    readFileSync(path.join(repoRoot, source), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    source.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function hasDirective(source: ts.SourceFile, directive: string): boolean {
  return source.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === directive
  );
}

function resolveLocal(
  repoRoot: string,
  source: string,
  specifier: string
): string | null {
  const unresolved = specifier.startsWith("@/")
    ? path.join(repoRoot, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(repoRoot, path.dirname(source), specifier)
      : null;
  if (!unresolved) return null;
  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    path.join(unresolved, "index.ts"),
    path.join(unresolved, "index.tsx"),
  ];
  const found = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile()
  );
  return found ? normalize(path.relative(repoRoot, found)) : null;
}

function isPlantIntelligenceRsc(source: string): boolean {
  return (
    source === PAGE_SOURCE ||
    source === COMPONENT_ROOT ||
    source.startsWith(`${COMPONENT_ROOT}/`)
  );
}

function runtimeImports(source: ts.SourceFile): ReadonlyMap<string, string> {
  const imports = new Map<string, string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      statement.importClause.isTypeOnly
    )
      continue;
    const clause = statement.importClause;
    if (clause.name) imports.set(clause.name.text, "default");
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly)
          imports.set(
            element.name.text,
            element.propertyName?.text ?? element.name.text
          );
      }
    } else if (
      clause.namedBindings &&
      ts.isNamespaceImport(clause.namedBindings)
    ) {
      throw new Error(
        `Plant Intelligence RSC discovery refuses namespace imports: ${source.fileName}`
      );
    }
  }
  return imports;
}

function importedName(
  expression: ts.LeftHandSideExpression,
  imports: ReadonlyMap<string, string>
): string | null {
  if (ts.isIdentifier(expression)) return imports.get(expression.text) ?? null;
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    const root = imports.get(expression.expression.text);
    return root ? `${root}.${expression.name.text}` : null;
  }
  return null;
}

function underAwait(node: ts.Node, source: ts.SourceFile): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isAwaitExpression(current)) return true;
    if (current === source) return false;
  }
  return false;
}

function fromTableName(node: ts.CallExpression): string | null {
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== "from" ||
    node.arguments.length !== 1 ||
    !ts.isIdentifier(node.arguments[0])
  )
    return null;
  return node.arguments[0].text;
}

const operationIdentity = (source: string, operation: string) =>
  `rsc-operation:${source} → ${operation}`;

/**
 * Discover awaited imported calls from the /phase RSC and its delegated
 * phase-engine server components. Client islands and server-action modules are
 * separate authoritative surfaces and stop traversal.
 */
export function discoverPlantIntelligenceRscOperations(
  repoRoot = process.cwd()
): readonly string[] {
  const visited = new Set<string>();
  const operations = new Set<string>();
  const visit = (sourceName: string): void => {
    if (visited.has(sourceName)) return;
    visited.add(sourceName);
    const source = parsed(repoRoot, sourceName);
    if (
      hasDirective(source, "use client") ||
      hasDirective(source, "use server")
    )
      return;
    const imports = runtimeImports(source);
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && underAwait(node, source)) {
        const imported = importedName(node.expression, imports);
        if (imported) operations.add(operationIdentity(sourceName, imported));
        const table = fromTableName(node);
        if (table && imports.has(table))
          operations.add(operationIdentity(sourceName, `db.from(${table})`));
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      )
        throw new Error(
          `Plant Intelligence RSC discovery refuses dynamic imports: ${sourceName}`
        );
      ts.forEachChild(node, walk);
    };
    walk(source);
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const resolved = resolveLocal(
        repoRoot,
        sourceName,
        statement.moduleSpecifier.text
      );
      if (resolved && isPlantIntelligenceRsc(resolved)) visit(resolved);
    }
  };
  visit(PAGE_SOURCE);
  return Object.freeze([...operations].toSorted());
}

function exportedRuntimeNames(source: ts.SourceFile): readonly string[] {
  const names: string[] = [];
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    const exported = modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    );
    if (
      exported &&
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
    ) {
      if (!statement.name)
        throw new Error(
          `Unnamed Plant Intelligence action in ${source.fileName}`
        );
      names.push(statement.name.text);
    } else if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name))
          throw new Error(
            `Unsupported Plant Intelligence action export in ${source.fileName}`
          );
        names.push(declaration.name.text);
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause))
        throw new Error(
          `Unbounded Plant Intelligence action export in ${source.fileName}`
        );
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) names.push(element.name.text);
      }
    }
  }
  return names.toSorted();
}

/** Independent discovery of every `use server` export under the phase route. */
export function discoverPlantIntelligenceActionIdentities(
  repoRoot = process.cwd()
): readonly string[] {
  const directory = path.join(repoRoot, ROUTE_ROOT);
  const identities: string[] = [];
  for (const name of [
    "actions.ts",
    "checkin-actions.ts",
    "feedback-actions.ts",
    "signals-actions.ts",
  ]) {
    const sourceName = normalize(
      path.relative(repoRoot, path.join(directory, name))
    );
    const source = parsed(repoRoot, sourceName);
    if (!hasDirective(source, "use server"))
      throw new Error(
        `Plant Intelligence action module lost use server: ${sourceName}`
      );
    for (const exportName of exportedRuntimeNames(source))
      identities.push(`action:${sourceName} → ${exportName}`);
  }
  return Object.freeze(identities.toSorted());
}

export const plantIntelligenceRscOperationIdentity = operationIdentity;
