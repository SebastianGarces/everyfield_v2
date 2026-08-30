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
  ["redirect", "Next navigation boundary, not Meetings domain data."],
  ["notFound", "Next navigation boundary, not Meetings domain data."],
  ["holdsSeatFor", "Shared authorization boundary, not Meetings domain data."],
  ["parseMeetingType", "Meetings presentation parser, not a data read."],
  ["meetingDisplayTitle", "Meetings presentation helper, not a data read."],
  ["meetingComposeUrl", "Communication link builder, not a data read."],
  [
    "getMeetingContextualTemplates",
    "Static document-template projection, not an authenticated data read.",
  ],
  ["meetingsListSubtitle", "Meetings presentation copy, not a data read."],
  [
    "parseListMeetingTypeFilter",
    "Meetings query-string parser, not a data read.",
  ],
  ["analyticsMeetingTypeArg", "Meetings filter projection, not a data read."],
  [
    "analyticsMeetingTypeLabel",
    "Meetings presentation label, not a data read.",
  ],
  [
    "parseAnalyticsMeetingTypeFilter",
    "Meetings query-string parser, not a data read.",
  ],
  ["compareEvaluationToHistory", "In-memory projection, not a data read."],
  ["defaultAgendaTemplatesForType", "Static agenda template, not a data read."],
  ["parseAgenda", "Stored agenda value parser, not a separate data read."],
  [
    "meetingLinkedTaskProgressCopy",
    "Meetings presentation copy, not a data read.",
  ],
  ["cn", "CSS class composition helper, not a data operation."],
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

function blockHasUseServerDirective(body: ts.Block): boolean {
  return body.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use server"
  );
}

type RuntimeFunctionDeclaration =
  | ts.ArrowFunction
  | ts.ConstructorDeclaration
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration;

function isRuntimeFunctionDeclaration(
  node: ts.Node
): node is RuntimeFunctionDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function inlineServerActionName(node: RuntimeFunctionDeclaration): string {
  if (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
    node.name
  ) {
    return node.name.text;
  }
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }
  if (
    (ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name
  ) {
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
      return node.name.text;
    }
  }
  throw new Error(
    `Meetings route has an unnamed function-level server action: ${node.getSourceFile().fileName}`
  );
}

function inlineServerActionNames(sourceFile: ts.SourceFile): readonly string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      isRuntimeFunctionDeclaration(node) &&
      node.body &&
      ts.isBlock(node.body) &&
      blockHasUseServerDirective(node.body)
    ) {
      names.push(inlineServerActionName(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names.toSorted();
}

function hasInlineServerAction(sourceFile: ts.SourceFile): boolean {
  return inlineServerActionNames(sourceFile).length > 0;
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
        const sourceFile = parsedSource(source, absoluteSource);
        return isServerModule(sourceFile) || hasInlineServerAction(sourceFile);
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
      .flatMap((source) => {
        const sourceFile = parsedSource(source, path.join(repoRoot, source));
        const names = [
          ...(isServerModule(sourceFile)
            ? exportedRuntimeNames(sourceFile)
            : []),
          ...inlineServerActionNames(sourceFile),
        ];
        return names.map((exportName) => `action:${source} → ${exportName}`);
      })
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

function drizzleQueryTableForCall(node: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  if (
    node.expression.name.text === "from" &&
    ts.isIdentifier(node.arguments[0])
  ) {
    return node.arguments[0].text;
  }
  const receiver = node.expression.expression;
  if (
    ts.isPropertyAccessExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    ts.isIdentifier(receiver.expression.expression) &&
    receiver.expression.name.text === "query"
  ) {
    return receiver.name.text;
  }
  return null;
}

/** Discover every imported call and direct table read used by a page render. */
export function discoverMeetingsPageReadOperations(
  repoRoot = process.cwd()
): readonly string[] {
  const discovered = new Set<string>();
  for (const source of discoverMeetingsPageSources(repoRoot)) {
    const absoluteSource = path.join(repoRoot, source);
    const sourceFile = parsedSource(source, absoluteSource);
    const importedByLocalName = new Map<string, string>();
    const namespaceImports = new Set<string>();
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause) {
        continue;
      }
      if (statement.importClause.name) {
        importedByLocalName.set(statement.importClause.name.text, "default");
      }
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          importedByLocalName.set(
            element.name.text,
            element.propertyName?.text ?? element.name.text
          );
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        namespaceImports.add(bindings.name.text);
      }
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          const imported = importedByLocalName.get(node.expression.text);
          if (imported) discovered.add(identity(source, imported));
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          namespaceImports.has(node.expression.expression.text)
        ) {
          discovered.add(identity(source, node.expression.name.text));
        }
        const table = drizzleQueryTableForCall(node);
        const importedTable = table
          ? (importedByLocalName.get(table) ?? table)
          : null;
        if (importedTable) discovered.add(identity(source, importedTable));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
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
