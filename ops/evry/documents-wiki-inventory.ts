import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  format as formatWithPrettier,
  resolveConfig as resolvePrettierConfig,
} from "prettier";
import ts from "typescript";

import type { Capability } from "../../src/lib/auth/seat-rules";
import { collectActionSurfaces, collectRouteSurfaces } from "./inventory";

const GENERATED_INVENTORY = path.join(
  "src",
  "lib",
  "evry",
  "capabilities",
  "documents-wiki",
  "inventory.generated.json"
);
const DASHBOARD_ROOT = path.join("src", "app", "(dashboard)");

const FIXTURE_CLASSES = [
  "selection",
  "arguments",
  "confirmation",
  "execution",
  "idempotency",
  "failure",
] as const;

type OperationKind = "read" | "effect";
type Domain = "documents" | "wiki" | "people_files";

export type DocumentsWikiSurface = Readonly<{
  kind: "action" | "route" | "route_handler" | "rsc_read" | "delegated";
  identity: string;
  source: string;
  exportName: string | null;
  capabilityIdentity: string;
  domain: Domain;
  operationKind: OperationKind | "delegated" | "excluded";
  applicationCapability: Capability | null;
  confirmation: "required" | "not_required" | "delegated" | "excluded";
  classification:
    | Readonly<{ state: "supported" }>
    | Readonly<{ state: "delegated"; owner: "people" }>
    | Readonly<{ state: "excluded"; reason: "external_secret_webhook" }>;
}>;

export type DocumentsWikiInventory = Readonly<{
  schemaVersion: 1;
  generatedBy: "pnpm evry:documents-wiki-inventory";
  capabilities: readonly Readonly<{
    identity: string;
    surfaceIdentities: readonly string[];
    parityCapability: "documents-and-files" | "wiki";
    domain: "documents" | "wiki";
    operationKind: OperationKind;
    applicationCapability: Capability;
    confirmation: "required" | "not_required";
    fixtureClasses: typeof FIXTURE_CLASSES;
  }>[];
  entries: readonly DocumentsWikiSurface[];
  summary: Readonly<{
    actions: number;
    routes: number;
    routeHandlers: number;
    rscReads: number;
    delegatedPeopleFileSurfaces: number;
    excludedExternalWebhooks: number;
    readCapabilities: number;
    effectCapabilities: number;
    unclassified: 0;
  }>;
}>;

const ACTIONS = {
  getGeneratedDocumentDownloadUrlAction: [
    "documents.history.download",
    "documents",
    "read",
    "not_required",
  ],
  searchWikiArticles: ["wiki.search", "wiki", "read", "not_required"],
  submitArticleFeedbackAction: [
    "wiki.feedback.set",
    "wiki",
    "effect",
    "required",
  ],
  toggleBookmark: ["wiki.bookmark.set", "wiki", "effect", "required"],
  recordView: ["wiki.progress.set", "wiki", "effect", "required"],
  updateProgress: ["wiki.progress.set", "wiki", "effect", "required"],
} as const;

const ROUTES = {
  "/documents": ["documents.templates.list", "documents"],
  "/documents/history": ["documents.history.list", "documents"],
  "/wiki": ["wiki.navigation.read", "wiki"],
  "/wiki/[...slug]": ["wiki.article.read", "wiki"],
  "/wiki/progress": ["wiki.progress.read", "wiki"],
} as const;

const ROUTE_HANDLER_CONTRACTS = {
  "handler:GET:/api/documents/[templateId]": [
    "documents.generate",
    "documents",
    "effect",
    "read",
  ],
  "handler:GET:/api/documents/history/[id]": [
    "documents.history.download",
    "documents",
    "read",
    "read",
  ],
  "handler:GET:/api/wiki/article": [
    "wiki.article.read",
    "wiki",
    "read",
    "read",
  ],
  "handler:POST:/api/wiki/revalidate": [
    "wiki.external.revalidate",
    "wiki",
    "excluded",
    null,
  ],
  "handler:DELETE:/api/wiki/revalidate": [
    "wiki.external.revalidate",
    "wiki",
    "excluded",
    null,
  ],
} as const;

const RSC_READ_CONTRACTS = {
  compileArticle: ["wiki.article.read", "wiki"],
  getArticle: ["wiki.article.read", "wiki"],
  getArticleFeedbackForUser: ["wiki.article.read", "wiki"],
  getArticleNavigation: ["wiki.navigation.read", "wiki"],
  getArticles: ["wiki.navigation.read", "wiki"],
  getArticlesByPrefix: ["wiki.navigation.read", "wiki"],
  getArticlesProgress: ["wiki.progress.read", "wiki"],
  getBookmarkedSlugs: ["wiki.navigation.read", "wiki"],
  getBookmarks: ["wiki.navigation.read", "wiki"],
  getLastInProgress: ["wiki.progress.read", "wiki"],
  getProgressStats: ["wiki.progress.read", "wiki"],
  getRecentlyViewed: ["wiki.progress.read", "wiki"],
  getWikiNavigation: ["wiki.navigation.read", "wiki"],
  isBookmarked: ["wiki.navigation.read", "wiki"],
  listGeneratedDocuments: ["documents.history.list", "documents"],
  resolveDocumentMergeContext: ["documents.templates.list", "documents"],
} as const;

const DELEGATED_PEOPLE_FILE_SURFACES = [
  "action:src/app/(dashboard)/people/import-export-actions.ts → exportPeopleAction",
  "action:src/app/(dashboard)/people/import-export-actions.ts → previewImportAction",
  "action:src/app/(dashboard)/people/import-export-actions.ts → executeBulkImportAction",
  "action:src/app/(dashboard)/people/import-export-actions.ts → downloadCsvTemplateAction",
] as const;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function walk(directory: string): string[] {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true })
    .toSorted((left, right) => compare(left.name, right.name))
    .flatMap((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(full) : entry.isFile() ? [full] : [];
    });
}

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function exportedHttpMethods(sourceFile: ts.SourceFile): string[] {
  const methods = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      hasExportModifier(statement) &&
      HTTP_METHODS.has(statement.name.text)
    )
      methods.add(statement.name.text);
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          HTTP_METHODS.has(declaration.name.text)
        )
          methods.add(declaration.name.text);
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements)
        if (HTTP_METHODS.has(element.name.text)) methods.add(element.name.text);
    }
  }
  return [...methods].toSorted(compare);
}

function discoverRouteHandlers(repoRoot: string) {
  const appRoot = path.join(repoRoot, "src", "app");
  return ["documents", "wiki"]
    .flatMap((domain) =>
      walk(path.join(appRoot, "api", domain)).flatMap((file) => {
        if (!/\/route\.[cm]?[jt]sx?$/.test(toPosix(file))) return [];
        const sourceFile = ts.createSourceFile(
          file,
          readFileSync(file, "utf8"),
          ts.ScriptTarget.Latest,
          true
        );
        const routePath = `/${toPosix(path.relative(appRoot, file)).replace(/\/route\.[cm]?[jt]sx?$/, "")}`;
        return exportedHttpMethods(sourceFile).map((exportName) => ({
          identity: `handler:${exportName}:${routePath}`,
          source: toPosix(path.relative(repoRoot, file)),
          exportName,
        }));
      })
    )
    .toSorted((left, right) => compare(left.identity, right.identity));
}

type DiscoveredRscRead = Readonly<{
  caller: string;
  modulePath: string;
  exportName: string;
}>;

function compilerOptions(repoRoot: string): ts.CompilerOptions {
  const configPath = path.join(repoRoot, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(
      `Documents/wiki inventory could not read tsconfig.json: ${ts.flattenDiagnosticMessageText(config.error.messageText, "\n")}`
    );
  return ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot).options;
}

function resolvedSymbol(
  checker: ts.TypeChecker,
  node: ts.Node
): ts.Symbol | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  const seen = new Set<ts.Symbol>();
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    if (seen.has(symbol)) return undefined;
    seen.add(symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol;
}

function callTargetNode(call: ts.CallExpression): ts.Node | null {
  if (ts.isIdentifier(call.expression)) return call.expression;
  if (ts.isPropertyAccessExpression(call.expression))
    return call.expression.name;
  if (ts.isElementAccessExpression(call.expression))
    return call.expression.argumentExpression;
  return null;
}

function callIsAwaited(call: ts.CallExpression): boolean {
  for (
    let current: ts.Node | undefined = call.parent;
    current;
    current = current.parent
  ) {
    if (ts.isAwaitExpression(current)) return true;
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return false;
  }
  return false;
}

function documentsWikiDeclaration(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  repoRoot: string
): Omit<DiscoveredRscRead, "caller"> | null {
  const target = callTargetNode(call);
  if (!target) return null;
  const symbol = resolvedSymbol(checker, target);
  if (!symbol) return null;
  const declaration =
    symbol.valueDeclaration ??
    symbol.declarations?.find(
      (candidate) =>
        ts.isFunctionDeclaration(candidate) ||
        ts.isVariableDeclaration(candidate) ||
        ts.isMethodDeclaration(candidate)
    );
  if (!declaration) return null;
  const absoluteSource = path.resolve(declaration.getSourceFile().fileName);
  const roots = ["documents", "wiki"].map((domain) =>
    path.resolve(repoRoot, "src", "lib", domain)
  );
  if (
    !roots.some(
      (root) =>
        absoluteSource === root ||
        absoluteSource.startsWith(`${root}${path.sep}`)
    )
  )
    return null;
  const declarationNameNode = (declaration as ts.NamedDeclaration).name;
  const exportName =
    declarationNameNode && ts.isIdentifier(declarationNameNode)
      ? declarationNameNode.text
      : symbol.name;
  return {
    modulePath: toPosix(path.relative(repoRoot, absoluteSource))
      .replace(/^src\//, "@/")
      .replace(/\.[cm]?[jt]sx?$/, ""),
    exportName,
  };
}

/** Compiler-backed discovery of actual awaited Documents/wiki calls in RSCs. */
export function discoverDocumentsWikiRscReads(
  repoRoot: string
): DiscoveredRscRead[] {
  const candidates = walk(path.join(repoRoot, DASHBOARD_ROOT)).filter(
    (file) =>
      /\.[jt]sx?$/.test(file) &&
      !/\.(?:test|proof)\.[jt]sx?$/.test(file) &&
      !file.endsWith("/actions.ts")
  );
  const serverCandidates = candidates.filter(
    (file) => !/^\s*["']use client["'];/m.test(readFileSync(file, "utf8"))
  );
  const program = ts.createProgram({
    rootNames: serverCandidates,
    options: compilerOptions(repoRoot),
  });
  const checker = program.getTypeChecker();
  const discovered = new Map<string, DiscoveredRscRead>();
  for (const file of serverCandidates) {
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) continue;
    const caller = toPosix(path.relative(repoRoot, file));
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && callIsAwaited(node)) {
        const target = documentsWikiDeclaration(checker, node, repoRoot);
        if (target) {
          const read = { ...target, caller };
          discovered.set(
            `${caller}\0${read.modulePath}\0${read.exportName}`,
            read
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return [...discovered.values()].toSorted((left, right) =>
    compare(
      `${left.caller}\0${left.exportName}`,
      `${right.caller}\0${right.exportName}`
    )
  );
}

function applicationCapability(
  domain: Domain,
  kind: OperationKind
): Capability {
  return domain === "wiki" && kind === "effect" ? "self.write" : "read";
}

export function generateDocumentsWikiInventory(
  repoRoot: string
): DocumentsWikiInventory {
  const actions: DocumentsWikiSurface[] = collectActionSurfaces()
    .filter(
      ({ source, applicationCapability: capability }) =>
        capability !== null &&
        (source.startsWith("src/app/(dashboard)/documents/") ||
          source.startsWith("src/app/(dashboard)/wiki/") ||
          source === "src/lib/wiki/bookmarks.ts" ||
          source === "src/lib/wiki/progress.ts")
    )
    .map((surface) => {
      const contract = ACTIONS[surface.exportName as keyof typeof ACTIONS];
      if (!contract)
        throw new Error(
          `Documents/wiki inventory has no closed action contract for ${surface.identity}`
        );
      const [capabilityIdentity, domain, operationKind, confirmation] =
        contract;
      return {
        ...surface,
        domain,
        capabilityIdentity,
        operationKind,
        confirmation,
        classification: { state: "supported" },
      };
    });
  if (actions.length !== Object.keys(ACTIONS).length) {
    throw new Error(
      `Expected ${Object.keys(ACTIONS).length} Documents/wiki actions, found ${actions.length}`
    );
  }

  const routes: DocumentsWikiSurface[] = collectRouteSurfaces(repoRoot)
    .filter(({ path: routePath }) => routePath in ROUTES)
    .map((surface) => {
      const [capabilityIdentity, domain] =
        ROUTES[surface.path as keyof typeof ROUTES];
      return {
        kind: "route",
        identity: surface.identity,
        source: surface.sources.join(","),
        exportName: null,
        capabilityIdentity,
        domain,
        operationKind: "read",
        applicationCapability: "read",
        confirmation: "not_required",
        classification: { state: "supported" },
      };
    });
  if (routes.length !== Object.keys(ROUTES).length) {
    throw new Error(
      `Expected ${Object.keys(ROUTES).length} Documents/wiki routes, found ${routes.length}`
    );
  }

  const discoveredHandlers = discoverRouteHandlers(repoRoot);
  const handlers: DocumentsWikiSurface[] = discoveredHandlers.flatMap(
    ({ identity, source, exportName }) => {
      const contract =
        ROUTE_HANDLER_CONTRACTS[
          identity as keyof typeof ROUTE_HANDLER_CONTRACTS
        ];
      if (!contract)
        throw new Error(
          `Documents/wiki inventory has no closed route-handler contract for ${identity}`
        );
      const [capabilityIdentity, domain, operationKind, capability] = contract;
      if (operationKind === "excluded") return [];
      return {
        kind: "route_handler",
        identity,
        source,
        exportName,
        capabilityIdentity,
        domain,
        operationKind,
        applicationCapability: capability,
        confirmation: operationKind === "effect" ? "required" : "not_required",
        classification: { state: "supported" },
      } satisfies DocumentsWikiSurface;
    }
  );
  const excluded: DocumentsWikiSurface[] = discoveredHandlers.flatMap(
    ({ identity, source, exportName }) => {
      const contract =
        ROUTE_HANDLER_CONTRACTS[
          identity as keyof typeof ROUTE_HANDLER_CONTRACTS
        ];
      if (!contract)
        throw new Error(
          `Documents/wiki inventory has no closed route-handler contract for ${identity}`
        );
      const [capabilityIdentity, domain, operationKind] = contract;
      if (operationKind !== "excluded") return [];
      return [
        {
          kind: "route_handler",
          identity,
          source,
          exportName,
          capabilityIdentity,
          domain,
          operationKind: "excluded",
          applicationCapability: null,
          confirmation: "excluded",
          classification: {
            state: "excluded",
            reason: "external_secret_webhook",
          },
        },
      ];
    }
  );
  const rscReads: DocumentsWikiSurface[] = discoverDocumentsWikiRscReads(
    repoRoot
  ).map(({ caller: source, modulePath, exportName }) => {
    const contract =
      RSC_READ_CONTRACTS[exportName as keyof typeof RSC_READ_CONTRACTS];
    if (!contract)
      throw new Error(
        `Documents/wiki inventory has no closed RSC read contract for ${source} → ${modulePath}#${exportName}`
      );
    const [capabilityIdentity, domain] = contract;
    return {
      kind: "rsc_read",
      identity: `rsc-read:${source} → ${modulePath}#${exportName}`,
      source,
      exportName,
      capabilityIdentity,
      domain,
      operationKind: "read",
      applicationCapability: "read",
      confirmation: "not_required",
      classification: { state: "supported" },
    };
  });
  const delegated: DocumentsWikiSurface[] = DELEGATED_PEOPLE_FILE_SURFACES.map(
    (identity) => {
      const source = identity.slice("action:".length).split(" → ")[0]!;
      const exportName = identity.split(" → ")[1]!;
      const surface = collectActionSurfaces().find(
        (candidate) => candidate.identity === identity
      );
      if (!surface)
        throw new Error(`Delegated People file surface drifted: ${identity}`);
      return {
        kind: "delegated",
        identity,
        source,
        exportName,
        capabilityIdentity: "people.files.delegated",
        domain: "people_files",
        operationKind: "delegated",
        applicationCapability: surface.applicationCapability,
        confirmation: "delegated",
        classification: { state: "delegated", owner: "people" },
      };
    }
  );

  const entries = [
    ...actions,
    ...routes,
    ...handlers,
    ...excluded,
    ...rscReads,
    ...delegated,
  ].toSorted((a, b) => compare(a.identity, b.identity));
  if (
    new Set(entries.map(({ identity }) => identity)).size !== entries.length
  ) {
    throw new Error(
      "Documents/wiki inventory repeats an authoritative surface"
    );
  }
  const grouped = new Map<
    string,
    DocumentsWikiInventory["capabilities"][number]
  >();
  for (const entry of entries) {
    if (entry.classification.state !== "supported") continue;
    const operationKind = entry.operationKind as OperationKind;
    const domain = entry.domain as "documents" | "wiki";
    const existing = grouped.get(entry.capabilityIdentity);
    const next = {
      identity: entry.capabilityIdentity,
      surfaceIdentities: existing
        ? [...existing.surfaceIdentities, entry.identity]
        : [entry.identity],
      parityCapability:
        domain === "documents"
          ? ("documents-and-files" as const)
          : ("wiki" as const),
      domain,
      operationKind,
      applicationCapability: applicationCapability(domain, operationKind),
      confirmation:
        operationKind === "effect"
          ? ("required" as const)
          : ("not_required" as const),
      fixtureClasses: FIXTURE_CLASSES,
    };
    if (
      existing &&
      (existing.operationKind !== operationKind || existing.domain !== domain)
    ) {
      throw new Error(
        `Conflicting Documents/wiki capability ${entry.capabilityIdentity}`
      );
    }
    grouped.set(entry.capabilityIdentity, next);
  }
  const capabilities = [...grouped.values()]
    .map((entry) => ({
      ...entry,
      surfaceIdentities: [...entry.surfaceIdentities].toSorted(compare),
    }))
    .toSorted((a, b) => compare(a.identity, b.identity));
  return {
    schemaVersion: 1,
    generatedBy: "pnpm evry:documents-wiki-inventory",
    capabilities,
    entries,
    summary: {
      actions: actions.length,
      routes: routes.length,
      routeHandlers: handlers.length,
      rscReads: rscReads.length,
      delegatedPeopleFileSurfaces: delegated.length,
      excludedExternalWebhooks: excluded.length,
      readCapabilities: capabilities.filter(
        ({ operationKind }) => operationKind === "read"
      ).length,
      effectCapabilities: capabilities.filter(
        ({ operationKind }) => operationKind === "effect"
      ).length,
      unclassified: 0,
    },
  };
}

export async function serializeDocumentsWikiInventory(
  inventory: DocumentsWikiInventory,
  repoRoot: string
) {
  const outputPath = path.join(repoRoot, GENERATED_INVENTORY);
  const config = await resolvePrettierConfig(outputPath);
  return formatWithPrettier(JSON.stringify(inventory), {
    ...config,
    filepath: outputPath,
    parser: "json",
  });
}

export async function writeDocumentsWikiInventory(
  repoRoot: string,
  inventory: DocumentsWikiInventory
) {
  writeFileSync(
    path.join(repoRoot, GENERATED_INVENTORY),
    await serializeDocumentsWikiInventory(inventory, repoRoot),
    "utf8"
  );
}

export async function assertDocumentsWikiInventoryCurrent(
  repoRoot: string,
  inventory: DocumentsWikiInventory
) {
  const actual = readFileSync(path.join(repoRoot, GENERATED_INVENTORY), "utf8");
  const expected = await serializeDocumentsWikiInventory(inventory, repoRoot);
  if (actual !== expected)
    throw new Error(
      "Documents/wiki capability inventory is stale; run `pnpm evry:documents-wiki-inventory`"
    );
}
