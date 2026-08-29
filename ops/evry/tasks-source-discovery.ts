import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

const TASKS_ROUTE_ROOT = path.join("src", "app", "(dashboard)", "tasks");

const normalizeSource = (source: string): string =>
  source.split(path.sep).join("/");

const readIdentity = (source: string, imported: string): string =>
  `read-operation:${normalizeSource(source)} → ${imported}`;

const sharedBoundaryExclusion = (
  source: string,
  imported: string,
  reason: string
) => Object.freeze({ identity: readIdentity(source, imported), reason });

const TASK_PAGE_SOURCES = [
  "src/app/(dashboard)/tasks/[id]/page.tsx",
  "src/app/(dashboard)/tasks/new/page.tsx",
  "src/app/(dashboard)/tasks/page.tsx",
  "src/app/(dashboard)/tasks/templates/page.tsx",
] as const;

export const TASK_ACTION_SOURCES = [
  "src/app/(dashboard)/tasks/actions.ts",
  "src/app/(dashboard)/tasks/follow-up-actions.ts",
  "src/app/(dashboard)/tasks/phase-prompt-actions.ts",
] as const;

/** Imported calls that are boundaries/query builders rather than Task reads. */
export const TASKS_DISCOVERED_READ_EXCLUSIONS = Object.freeze([
  ...TASK_PAGE_SOURCES.map((source) =>
    sharedBoundaryExclusion(
      source,
      "verifySession",
      "Shared authentication boundary, not Task Management domain data."
    )
  ),
  ...TASK_PAGE_SOURCES.filter(
    (source) => source.includes("/[id]/") || source.includes("/new/")
  ).map((source) =>
    sharedBoundaryExclusion(
      source,
      "eq",
      "Drizzle query construction helper, not a data operation."
    )
  ),
  sharedBoundaryExclusion(
    "src/app/(dashboard)/tasks/page.tsx",
    "taskListScope",
    "Pure Task-list filter construction; the consuming count read is classified."
  ),
]);

function pageSources(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) return pageSources(candidate);
      return entry.isFile() && entry.name === "page.tsx" ? [candidate] : [];
    })
    .toSorted();
}

/** Every authenticated Task Management page, discovered from the route tree. */
export function discoverTaskPageSources(
  repoRoot = process.cwd()
): readonly string[] {
  const routeRoot = path.join(repoRoot, TASKS_ROUTE_ROOT);
  return Object.freeze(
    pageSources(routeRoot).map((source) =>
      normalizeSource(path.relative(repoRoot, source))
    )
  );
}

function importedCalls(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const imports = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const { importClause } = statement;
    if (importClause.name) {
      imports.set(importClause.name.text, "default");
    }
    if (
      importClause.namedBindings &&
      ts.isNamedImports(importClause.namedBindings)
    ) {
      for (const element of importClause.namedBindings.elements) {
        imports.set(
          element.name.text,
          element.propertyName?.text ?? element.name.text
        );
      }
    }
  }
  return imports;
}

function awaitedByPage(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  for (
    let current = node.parent;
    current && current !== sourceFile;
    current = current.parent
  ) {
    if (ts.isAwaitExpression(current)) return true;
  }
  return false;
}

function importedCallName(
  expression: ts.LeftHandSideExpression,
  imports: ReadonlyMap<string, string>
): string | null {
  if (ts.isIdentifier(expression)) {
    return imports.get(expression.text) ?? null;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    const imported = imports.get(expression.expression.text);
    return imported ? `${imported}.${expression.name.text}` : null;
  }
  return null;
}

/**
 * Discover imported operations that participate in an awaited Task page read.
 *
 * This deliberately starts from the route tree rather than Evry registrations,
 * so a new page or server read is unclassified until the inventory maps or
 * explicitly excludes it.
 */
export function discoverTaskPageReadOperations(
  repoRoot = process.cwd()
): readonly string[] {
  const discovered = new Set<string>();
  for (const source of discoverTaskPageSources(repoRoot)) {
    const absoluteSource = path.join(repoRoot, source);
    const sourceFile = ts.createSourceFile(
      source,
      readFileSync(absoluteSource, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const imports = importedCalls(sourceFile);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && awaitedByPage(node, sourceFile)) {
        const imported = importedCallName(node.expression, imports);
        if (imported) discovered.add(readIdentity(source, imported));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return Object.freeze([...discovered].toSorted());
}

/**
 * Discover the server-action exports independently from the auth capability
 * map. A new unguarded export must therefore fail parity instead of remaining
 * invisible to the inventory source that was supposed to classify it.
 */
export function discoverTaskActionIdentities(
  repoRoot = process.cwd()
): readonly string[] {
  const identities: string[] = [];
  for (const source of TASK_ACTION_SOURCES) {
    const sourceFile = ts.createSourceFile(
      source,
      readFileSync(path.join(repoRoot, source), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const serverModule = sourceFile.statements.some(
      (statement) =>
        ts.isExpressionStatement(statement) &&
        ts.isStringLiteral(statement.expression) &&
        statement.expression.text === "use server"
    );
    if (!serverModule) {
      throw new Error(`Task action source is missing use server: ${source}`);
    }
    for (const statement of sourceFile.statements) {
      if (
        !ts.isFunctionDeclaration(statement) ||
        !statement.name ||
        !statement.modifiers?.some(
          ({ kind }) => kind === ts.SyntaxKind.ExportKeyword
        ) ||
        !statement.modifiers.some(
          ({ kind }) => kind === ts.SyntaxKind.AsyncKeyword
        )
      ) {
        continue;
      }
      identities.push(`action:${source} → ${statement.name.text}`);
    }
  }
  return Object.freeze(identities.toSorted());
}

export const taskReadIdentity = readIdentity;
