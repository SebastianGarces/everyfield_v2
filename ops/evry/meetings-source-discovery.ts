import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import parityInventory from "../../src/lib/evry/capabilities/inventory.generated.json";

const MEETINGS_ROUTE_ROOTS = Object.freeze([
  path.join("src", "app", "(dashboard)", "meetings"),
  path.join("src", "app", "(dashboard)", "teams", "[teamId]", "meetings"),
]);

const normalizeSource = (source: string): string =>
  source.split(path.sep).join("/");

const identity = (source: string, imported: string) =>
  `read-operation:${normalizeSource(source)} → ${imported}`;

const BOUNDARY_EXCLUSION_REASON = new Map([
  [
    "verifySession",
    "Shared authentication boundary, not Meetings domain data.",
  ],
  [
    "getCurrentUserChurch",
    "Shared plant navigation context, not Meetings domain data.",
  ],
  ["eq", "Drizzle query construction helper, not a data operation."],
  ["churches", "Shared plant-name context, not Meetings domain data."],
]);

const CLASSIFIED_MEETINGS_ACTION_SOURCES = Object.freeze(
  parityInventory.entries
    .flatMap((entry) =>
      entry.kind === "action" &&
      entry.parityCapability === "meetings" &&
      typeof entry.source === "string"
        ? [entry.source]
        : []
    )
    .toSorted()
);

const CLASSIFIED_MEETINGS_PAGE_SOURCES = Object.freeze(
  parityInventory.entries
    .flatMap((entry) =>
      entry.kind === "route" &&
      entry.parityCapability === "meetings" &&
      Array.isArray(entry.sources)
        ? entry.sources
        : []
    )
    .toSorted()
);

function filesBelow(directory: string): readonly string[] {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true })
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const candidate = path.join(directory, entry.name);
      return entry.isDirectory()
        ? filesBelow(candidate)
        : entry.isFile()
          ? [candidate]
          : [];
    });
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
          `Meetings server module has an unnamed runtime export: ${sourceFile.fileName}`
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
            `Meetings server module has an unsupported exported binding: ${sourceFile.fileName}`
          );
        }
        names.push(declaration.name.text);
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (!statement.exportClause) {
        throw new Error(
          `Meetings server module has an unbounded star export: ${sourceFile.fileName}`
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

/** Every classified Meetings action module plus every module in its route trees. */
export function discoverMeetingsActionSources(
  repoRoot = process.cwd()
): readonly string[] {
  const classifiedSources = CLASSIFIED_MEETINGS_ACTION_SOURCES.map((source) =>
    path.join(repoRoot, source)
  );
  return Object.freeze(
    [
      ...classifiedSources,
      ...MEETINGS_ROUTE_ROOTS.flatMap((root) =>
        filesBelow(path.join(repoRoot, root))
      ),
    ]
      .filter(
        (source) =>
          statSync(source, { throwIfNoEntry: false })?.isFile() &&
          /\.(?:ts|tsx)$/.test(source) &&
          !/\.(?:test|spec)\.(?:ts|tsx)$/.test(source)
      )
      .filter((absoluteSource) => {
        const source = normalizeSource(path.relative(repoRoot, absoluteSource));
        return isServerModule(parsedSource(source, absoluteSource));
      })
      .map((source) => normalizeSource(path.relative(repoRoot, source)))
      .filter((source, index, sources) => sources.indexOf(source) === index)
      .toSorted()
  );
}

/** Every runtime export from every recursively discovered Meetings action module. */
export function discoverMeetingsActionIdentities(
  repoRoot = process.cwd()
): readonly string[] {
  return Object.freeze(
    discoverMeetingsActionSources(repoRoot)
      .flatMap((source) =>
        exportedRuntimeNames(
          parsedSource(source, path.join(repoRoot, source))
        ).map((exportName) => `action:${source} → ${exportName}`)
      )
      .toSorted()
  );
}

/** Every Meetings page plus route-local layout that participates in its RSC tree. */
export function discoverMeetingsPageSources(
  repoRoot = process.cwd()
): readonly string[] {
  return Object.freeze(
    [
      ...CLASSIFIED_MEETINGS_PAGE_SOURCES.map((source) =>
        path.join(repoRoot, source)
      ),
      ...MEETINGS_ROUTE_ROOTS.flatMap((root) =>
        filesBelow(path.join(repoRoot, root))
      ),
    ]
      .filter((source) => statSync(source, { throwIfNoEntry: false })?.isFile())
      .filter((source) => /(?:page|layout)\.tsx?$/.test(path.basename(source)))
      .map((source) => normalizeSource(path.relative(repoRoot, source)))
      .filter((source, index, sources) => sources.indexOf(source) === index)
      .toSorted()
  );
}

export const CLASSIFIED_MEETINGS_ROUTE_IDENTITIES = Object.freeze(
  parityInventory.entries
    .filter(
      (entry) => entry.kind === "route" && entry.parityCapability === "meetings"
    )
    .map(({ identity }) => identity)
    .toSorted()
);

function isAwaited(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  for (
    let current = node.parent;
    current && current !== sourceFile;
    current = current.parent
  ) {
    if (ts.isAwaitExpression(current)) return true;
  }
  return false;
}

/** Discover every imported call whose result participates in an awaited page read. */
export function discoverMeetingsPageReadOperations(
  repoRoot = process.cwd()
): readonly string[] {
  const discovered = new Set<string>();
  for (const source of discoverMeetingsPageSources(repoRoot)) {
    const absoluteSource = path.join(repoRoot, source);
    const text = readFileSync(absoluteSource, "utf8");
    const sourceFile = parsedSource(source, absoluteSource);
    const importedByLocalName = new Map<string, string>();
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !statement.importClause?.namedBindings ||
        !ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        continue;
      }
      for (const element of statement.importClause.namedBindings.elements) {
        importedByLocalName.set(
          element.name.text,
          element.propertyName?.text ?? element.name.text
        );
      }
    }
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        isAwaited(node, sourceFile)
      ) {
        const imported = importedByLocalName.get(node.expression.text);
        if (imported) discovered.add(identity(source, imported));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    if (/\.from\(churches\)/.test(text)) {
      discovered.add(identity(source, "churches"));
    }
  }
  return Object.freeze([...discovered].toSorted());
}

export function meetingsDiscoveredReadExclusions(
  repoRoot = process.cwd()
): readonly Readonly<{ identity: string; reason: string }>[] {
  return Object.freeze(
    discoverMeetingsPageReadOperations(repoRoot).flatMap((operation) => {
      const imported = operation.slice(operation.lastIndexOf(" → ") + 3);
      const reason = BOUNDARY_EXCLUSION_REASON.get(imported);
      return reason ? [Object.freeze({ identity: operation, reason })] : [];
    })
  );
}

export const MEETINGS_DISCOVERED_READ_EXCLUSIONS =
  meetingsDiscoveredReadExclusions();

export const meetingsReadIdentity = identity;
