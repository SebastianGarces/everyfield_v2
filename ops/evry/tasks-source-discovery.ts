import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

const TASKS_ROUTE_ROOT = path.join("src", "app", "(dashboard)", "tasks");
const TASKS_COMPONENT_ROOT = path.join("src", "components", "tasks");

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
  ).flatMap((source) => [
    sharedBoundaryExclusion(
      source,
      "eq",
      "Drizzle query construction helper, not a data operation."
    ),
    sharedBoundaryExclusion(
      source,
      "exactTaskAssigneeJoin",
      "Task tenancy query construction helper, not a data operation."
    ),
  ]),
  sharedBoundaryExclusion(
    "src/app/(dashboard)/tasks/page.tsx",
    "taskListScope",
    "Pure Task-list filter construction; the consuming count read is classified."
  ),
  sharedBoundaryExclusion(
    "src/components/tasks/phase-template-prompt.tsx",
    "getCurrentSession",
    "Shared authentication boundary, not Task Management domain data."
  ),
  sharedBoundaryExclusion(
    "src/components/tasks/phase-template-prompt.tsx",
    "cookies",
    "Next.js request boundary, not Task Management domain data."
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

function moduleSources(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) return moduleSources(candidate);
      return entry.isFile() &&
        /\.(?:ts|tsx)$/.test(entry.name) &&
        !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)
        ? [candidate]
        : [];
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

function parsedSource(source: string, absoluteSource: string): ts.SourceFile {
  return ts.createSourceFile(
    source,
    readFileSync(absoluteSource, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    source.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function isServerModule(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use server"
  );
}

function isClientModule(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use client"
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === kind)
  );
}

function exportedRuntimeNames(sourceFile: ts.SourceFile): readonly string[] {
  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        names.push("default");
      } else if (statement.name) {
        names.push(statement.name.text);
      } else {
        throw new Error(
          `Task server module has an unnamed exported runtime declaration: ${sourceFile.fileName}`
        );
      }
      continue;
    }
    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          throw new Error(
            `Task server module has an unsupported exported binding: ${sourceFile.fileName}`
          );
        }
        names.push(declaration.name.text);
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (!statement.exportClause) {
        throw new Error(
          `Task server module has an unbounded star export: ${sourceFile.fileName}`
        );
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        names.push(statement.exportClause.name.text);
      } else {
        for (const element of statement.exportClause.elements) {
          if (!element.isTypeOnly) names.push(element.name.text);
        }
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) names.push("default");
  }
  return names.toSorted();
}

/** Every server-action module under the authenticated Task route tree. */
export function discoverTaskActionSources(
  repoRoot = process.cwd()
): readonly string[] {
  const routeRoot = path.join(repoRoot, TASKS_ROUTE_ROOT);
  return Object.freeze(
    moduleSources(routeRoot)
      .filter((absoluteSource) => {
        const source = normalizeSource(path.relative(repoRoot, absoluteSource));
        return isServerModule(parsedSource(source, absoluteSource));
      })
      .map((source) => normalizeSource(path.relative(repoRoot, source)))
      .toSorted()
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

function importedModuleSpecifiers(
  sourceFile: ts.SourceFile
): readonly string[] {
  return sourceFile.statements.flatMap((statement) => {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [statement.moduleSpecifier.text];
    }
    return [];
  });
}

function resolveLocalModule(
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
  const resolved = candidates.find(
    (candidate) =>
      /\.tsx?$/.test(candidate) &&
      existsSync(candidate) &&
      statSync(candidate).isFile()
  );
  return resolved ? normalizeSource(path.relative(repoRoot, resolved)) : null;
}

function isTaskRscSource(source: string): boolean {
  return (
    source === normalizeSource(TASKS_ROUTE_ROOT) ||
    source.startsWith(`${normalizeSource(TASKS_ROUTE_ROOT)}/`) ||
    source === normalizeSource(TASKS_COMPONENT_ROOT) ||
    source.startsWith(`${normalizeSource(TASKS_COMPONENT_ROOT)}/`)
  );
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
 * Discover imported operations that participate in an awaited Task RSC read.
 *
 * This deliberately starts from the route tree and follows its local Task
 * server-component import graph rather than trusting Evry registrations. A
 * read delegated out of `page.tsx` is therefore still unclassified until the
 * inventory maps or explicitly excludes it. Client islands and server-action
 * modules are different execution surfaces and end traversal.
 */
export function discoverTaskPageReadOperations(
  repoRoot = process.cwd()
): readonly string[] {
  const discovered = new Set<string>();
  const visited = new Set<string>();
  const visitSource = (source: string): void => {
    if (visited.has(source)) return;
    visited.add(source);
    const absoluteSource = path.join(repoRoot, source);
    const sourceFile = parsedSource(source, absoluteSource);
    if (isClientModule(sourceFile) || isServerModule(sourceFile)) return;
    const imports = importedCalls(sourceFile);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && awaitedByPage(node, sourceFile)) {
        const imported = importedCallName(node.expression, imports);
        if (imported) discovered.add(readIdentity(source, imported));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    for (const specifier of importedModuleSpecifiers(sourceFile)) {
      const importedSource = resolveLocalModule(repoRoot, source, specifier);
      if (importedSource && isTaskRscSource(importedSource)) {
        visitSource(importedSource);
      }
    }
  };
  for (const source of discoverTaskPageSources(repoRoot)) {
    visitSource(source);
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
  for (const source of discoverTaskActionSources(repoRoot)) {
    const sourceFile = parsedSource(source, path.join(repoRoot, source));
    for (const exportName of exportedRuntimeNames(sourceFile)) {
      identities.push(`action:${source} → ${exportName}`);
    }
  }
  return Object.freeze(identities.toSorted());
}

export const taskReadIdentity = readIdentity;
