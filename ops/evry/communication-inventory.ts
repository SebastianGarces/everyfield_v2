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
  "communication",
  "inventory.generated.json"
);

const COMMUNICATION_ACTION_SOURCE =
  "src/app/(dashboard)/communication/actions.ts";
const DASHBOARD_ROOT = path.join("src", "app", "(dashboard)");

export type CommunicationEvryOperationKind = "read" | "effect";
export type CommunicationEvryMutationShape =
  | "single_create"
  | "single_update"
  | "single_delete"
  | "compound_write"
  | "external_send"
  | "external_resend";

export type CommunicationEvrySurface = Readonly<{
  kind: "action" | "route" | "rsc_read" | "external" | "product_gap";
  identity: string;
  source: string;
  exportName: string | null;
  capabilityIdentity: string;
  domain: string;
  operationKind: CommunicationEvryOperationKind | "excluded";
  applicationCapability: Capability | null;
  confirmation: "not_required" | "required" | "excluded";
  mutationShape: CommunicationEvryMutationShape | null;
  classification:
    | Readonly<{ state: "supported" }>
    | Readonly<{
        state: "excluded";
        reason: "public_or_sessionless" | "owning_product_gap";
      }>;
}>;

export type CommunicationEvryCapabilityInventory = Readonly<{
  schemaVersion: 1;
  generatedBy: "pnpm evry:communication-inventory";
  authoritativeSources: Readonly<{
    actions: "src/lib/auth/capability-map.ts";
    routes: "src/app/(dashboard)/communication/**/page.tsx";
    rscReads: "awaited @/lib/communication/* calls in dashboard server components";
    external: "Communication provider and RSVP route handlers";
  }>;
  capabilities: readonly Readonly<{
    identity: string;
    surfaceIdentities: readonly string[];
    parityCapability: "communication";
    domain: string;
    operationKind: CommunicationEvryOperationKind;
    applicationCapability: Capability;
    confirmation: "not_required" | "required";
    mutationShape: CommunicationEvryMutationShape | null;
  }>[];
  entries: readonly CommunicationEvrySurface[];
  summary: Readonly<{
    actions: number;
    routes: number;
    rscReads: number;
    externalExclusions: number;
    productGaps: number;
    readCapabilities: number;
    effectCapabilities: number;
    unclassified: 0;
  }>;
}>;

type SupportedContract = Readonly<{
  capabilityIdentity: string;
  domain: string;
  operationKind: CommunicationEvryOperationKind;
  mutationShape: CommunicationEvryMutationShape | null;
}>;

const ACTION_CONTRACTS = {
  createTemplateAction: {
    capabilityIdentity: "communication.templates.create",
    domain: "templates",
    operationKind: "effect",
    mutationShape: "single_create",
  },
  deleteTemplateAction: {
    capabilityIdentity: "communication.templates.delete",
    domain: "templates",
    operationKind: "effect",
    mutationShape: "single_delete",
  },
  forkTemplateAction: {
    capabilityIdentity: "communication.templates.fork",
    domain: "templates",
    operationKind: "effect",
    mutationShape: "compound_write",
  },
  getTemplatesAction: {
    capabilityIdentity: "communication.templates.list",
    domain: "templates",
    operationKind: "read",
    mutationShape: null,
  },
  resendToNonOpenersAction: {
    capabilityIdentity: "communication.resends.send-to-non-openers",
    domain: "resends",
    operationKind: "effect",
    mutationShape: "external_resend",
  },
  resolveGroupAction: {
    capabilityIdentity: "communication.recipients.resolve-group",
    domain: "recipients",
    operationKind: "read",
    mutationShape: null,
  },
  searchPeopleAction: {
    capabilityIdentity: "communication.recipients.search-people",
    domain: "recipients",
    operationKind: "read",
    mutationShape: null,
  },
  sendMessageAction: {
    capabilityIdentity: "communication.messages.send",
    domain: "messages",
    operationKind: "effect",
    mutationShape: "external_send",
  },
  updateTemplateAction: {
    capabilityIdentity: "communication.templates.update",
    domain: "templates",
    operationKind: "effect",
    mutationShape: "single_update",
  },
} as const satisfies Readonly<Record<string, SupportedContract>>;

const ROUTE_CONTRACTS = {
  "/communication": {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  "/communication/[id]": {
    capabilityIdentity: "communication.delivery.get-message",
    domain: "delivery",
    operationKind: "read",
    mutationShape: null,
  },
  "/communication/compose": {
    capabilityIdentity: "communication.compose.get-context",
    domain: "compose",
    operationKind: "read",
    mutationShape: null,
  },
  "/communication/history": {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  "/communication/templates": {
    capabilityIdentity: "communication.templates.list",
    domain: "templates",
    operationKind: "read",
    mutationShape: null,
  },
  "/communication/templates/[id]/edit": {
    capabilityIdentity: "communication.templates.get",
    domain: "templates",
    operationKind: "read",
    mutationShape: null,
  },
} as const satisfies Readonly<Record<string, SupportedContract>>;

const RSC_READ_CONTRACTS = {
  countCommunications: {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  countSentSince: {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  getChurchDeliveryTotals: {
    capabilityIdentity: "communication.delivery.get-church-totals",
    domain: "delivery",
    operationKind: "read",
    mutationShape: null,
  },
  getCommunication: {
    capabilityIdentity: "communication.delivery.get-message",
    domain: "delivery",
    operationKind: "read",
    mutationShape: null,
  },
  getCommunicationRecipients: {
    capabilityIdentity: "communication.delivery.get-message-recipients",
    domain: "delivery",
    operationKind: "read",
    mutationShape: null,
  },
  getCommunications: {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  getMeetingCommunications: {
    capabilityIdentity: "communication.history.get-meeting",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  getMeetingTrackingByPerson: {
    capabilityIdentity: "communication.delivery.get-meeting-tracking",
    domain: "delivery",
    operationKind: "read",
    mutationShape: null,
  },
  getNonOpenerSummary: {
    capabilityIdentity: "communication.resends.get-eligible-non-openers",
    domain: "resends",
    operationKind: "read",
    mutationShape: null,
  },
  getPersonCommunications: {
    capabilityIdentity: "communication.history.get-person",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  getTemplate: {
    capabilityIdentity: "communication.templates.get",
    domain: "templates",
    operationKind: "read",
    mutationShape: null,
  },
  getTemplates: {
    capabilityIdentity: "communication.templates.list",
    domain: "templates",
    operationKind: "read",
    mutationShape: null,
  },
  listRecipientTeams: {
    capabilityIdentity: "communication.recipients.list-teams",
    domain: "recipients",
    operationKind: "read",
    mutationShape: null,
  },
  resolveSubjects: {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
} as const satisfies Readonly<Record<string, SupportedContract>>;

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function walk(directory: string): string[] {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true })
    .toSorted((left, right) => compareStrings(left.name, right.name))
    .flatMap((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(full) : entry.isFile() ? [full] : [];
    });
}

function supportedSurface(
  input: Pick<
    CommunicationEvrySurface,
    "kind" | "identity" | "source" | "exportName"
  >,
  contract: SupportedContract,
  applicationCapability: Capability
): CommunicationEvrySurface {
  return {
    ...input,
    ...contract,
    applicationCapability,
    confirmation:
      contract.operationKind === "effect" ? "required" : "not_required",
    classification: { state: "supported" },
  };
}

function actionSurfaces(): CommunicationEvrySurface[] {
  const surfaces = collectActionSurfaces().filter(
    (surface) => surface.source === COMMUNICATION_ACTION_SOURCE
  );
  return surfaces.map((surface) => {
    const contract =
      ACTION_CONTRACTS[surface.exportName as keyof typeof ACTION_CONTRACTS];
    if (!contract || surface.applicationCapability === null) {
      throw new Error(
        `Communication inventory has no closed action contract for ${surface.identity}`
      );
    }
    return supportedSurface(
      {
        kind: "action",
        identity: surface.identity,
        source: surface.source,
        exportName: surface.exportName,
      },
      contract,
      surface.applicationCapability
    );
  });
}

function routeSurfaces(repoRoot: string): CommunicationEvrySurface[] {
  return collectRouteSurfaces(repoRoot)
    .filter(
      (surface) =>
        surface.path === "/communication" ||
        surface.path.startsWith("/communication/")
    )
    .map((surface) => {
      const contract =
        ROUTE_CONTRACTS[surface.path as keyof typeof ROUTE_CONTRACTS];
      if (!contract) {
        throw new Error(
          `Communication inventory has no closed route contract for ${surface.identity}`
        );
      }
      return supportedSurface(
        {
          kind: "route",
          identity: surface.identity,
          source: surface.sources.join(","),
          exportName: null,
        },
        contract,
        "read"
      );
    });
}

export type DiscoveredCommunicationRscRead = Readonly<{
  caller: string;
  modulePath: string;
  exportName: string;
}>;

function compilerOptions(repoRoot: string): ts.CompilerOptions {
  const configPath = path.join(repoRoot, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      `Communication inventory could not read tsconfig.json: ${ts.flattenDiagnosticMessageText(config.error.messageText, "\n")}`
    );
  }
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
  if (ts.isPropertyAccessExpression(call.expression)) {
    return call.expression.name;
  }
  if (ts.isElementAccessExpression(call.expression)) {
    return call.expression.argumentExpression;
  }
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

function communicationDeclaration(input: {
  checker: ts.TypeChecker;
  call: ts.CallExpression;
  repoRoot: string;
}): DiscoveredCommunicationRscRead | null {
  const target = callTargetNode(input.call);
  if (!target) return null;
  const symbol = resolvedSymbol(input.checker, target);
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
  const communicationRoot = path.resolve(
    input.repoRoot,
    "src",
    "lib",
    "communication"
  );
  if (
    absoluteSource !== communicationRoot &&
    !absoluteSource.startsWith(`${communicationRoot}${path.sep}`)
  ) {
    return null;
  }
  const declarationNameNode = (declaration as ts.NamedDeclaration).name;
  const declarationName =
    declarationNameNode && ts.isIdentifier(declarationNameNode)
      ? declarationNameNode.text
      : symbol.name;
  const relativeModule = toPosix(path.relative(input.repoRoot, absoluteSource));
  return {
    caller: "",
    modulePath: relativeModule
      .replace(/^src\//, "@/")
      .replace(/\.[cm]?[jt]sx?$/, ""),
    exportName: declarationName,
  };
}

/** Compiler-backed discovery: only actual awaited calls count as RSC reads. */
export function discoverCommunicationRscReads(
  repoRoot: string,
  dashboardRoot = DASHBOARD_ROOT
): DiscoveredCommunicationRscRead[] {
  const candidates = walk(path.join(repoRoot, dashboardRoot)).filter(
    (file) =>
      /\.[jt]sx?$/.test(file) &&
      !/\.(?:test|proof)\.[jt]sx?$/.test(file) &&
      !file.endsWith("/actions.ts")
  );
  const serverCandidates = candidates.filter((file) => {
    const source = readFileSync(file, "utf8");
    return !/^\s*["']use client["'];/m.test(source);
  });
  const program = ts.createProgram({
    rootNames: serverCandidates,
    options: compilerOptions(repoRoot),
  });
  const checker = program.getTypeChecker();
  const discovered = new Map<string, DiscoveredCommunicationRscRead>();
  for (const file of serverCandidates) {
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) continue;
    const caller = toPosix(path.relative(repoRoot, file));
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && callIsAwaited(node)) {
        const target = communicationDeclaration({
          checker,
          call: node,
          repoRoot,
        });
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
    compareStrings(
      `${left.caller}\0${left.modulePath}\0${left.exportName}`,
      `${right.caller}\0${right.modulePath}\0${right.exportName}`
    )
  );
}

function rscReadSurfaces(repoRoot: string): CommunicationEvrySurface[] {
  return discoverCommunicationRscReads(repoRoot).map((read) => {
    const contract =
      RSC_READ_CONTRACTS[read.exportName as keyof typeof RSC_READ_CONTRACTS];
    if (!contract) {
      throw new Error(
        `Communication inventory has no closed RSC read contract for ${read.caller} → ${read.modulePath}#${read.exportName}`
      );
    }
    return supportedSurface(
      {
        kind: "rsc_read",
        identity: `rsc-read:${read.caller} → ${read.modulePath}#${read.exportName}`,
        source: read.caller,
        exportName: read.exportName,
      },
      contract,
      "read"
    );
  });
}

type DiscoveredCommunicationRouteHandler = Readonly<{
  identity: string;
  source: string;
  exportName: string;
}>;

const EXTERNAL_CONTRACTS = {
  "handler:POST:/api/webhooks/resend": {
    capabilityIdentity: "communication.delivery.ingest-provider-event",
    domain: "delivery",
  },
  "handler:POST:/api/rsvp/[token]": {
    capabilityIdentity: "communication.rsvp.respond-by-token",
    domain: "rsvp",
  },
} as const;

function appRoutePath(repoRoot: string, file: string): string {
  const relative = toPosix(
    path.relative(path.join(repoRoot, "src", "app"), file)
  );
  return `/${relative.replace(/\/route\.[cm]?[jt]sx?$/, "")}`;
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
    ) {
      methods.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          HTTP_METHODS.has(declaration.name.text)
        ) {
          methods.add(declaration.name.text);
        }
      }
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (HTTP_METHODS.has(element.name.text)) methods.add(element.name.text);
      }
    }
  }
  return [...methods].toSorted(compareStrings);
}

/** Discover exact exported HTTP methods for communication-owned API routes. */
export function discoverCommunicationRouteHandlers(
  repoRoot: string
): DiscoveredCommunicationRouteHandler[] {
  const apiRoot = path.join(repoRoot, "src", "app", "api");
  const handlers: DiscoveredCommunicationRouteHandler[] = [];
  for (const file of walk(apiRoot).filter((candidate) =>
    /\/route\.[cm]?[jt]sx?$/.test(toPosix(candidate))
  )) {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true
    );
    const communicationOwned = sourceFile.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        (statement.moduleSpecifier.text.startsWith("@/lib/communication/") ||
          statement.moduleSpecifier.text === "@/db/schema/communication")
    );
    if (!communicationOwned) continue;
    const routePath = appRoutePath(repoRoot, file);
    for (const method of exportedHttpMethods(sourceFile)) {
      handlers.push({
        identity: `handler:${method}:${routePath}`,
        source: toPosix(path.relative(repoRoot, file)),
        exportName: method,
      });
    }
  }
  return handlers.toSorted((left, right) =>
    compareStrings(left.identity, right.identity)
  );
}

export function communicationExternalSurfaces(
  repoRoot: string
): CommunicationEvrySurface[] {
  const discovered = discoverCommunicationRouteHandlers(repoRoot);
  return discovered.map((handler) => {
    const contract =
      EXTERNAL_CONTRACTS[handler.identity as keyof typeof EXTERNAL_CONTRACTS];
    if (!contract) {
      throw new Error(
        `Communication inventory has no closed external contract for ${handler.identity}`
      );
    }
    return {
      kind: "external",
      identity: handler.identity,
      source: handler.source,
      exportName: handler.exportName,
      capabilityIdentity: contract.capabilityIdentity,
      domain: contract.domain,
      operationKind: "excluded",
      applicationCapability: null,
      confirmation: "excluded",
      mutationShape: null,
      classification: { state: "excluded", reason: "public_or_sessionless" },
    };
  });
}

function assertBijection(entries: readonly CommunicationEvrySurface[]): void {
  const identities = entries.map(({ identity }) => identity);
  const duplicates = identities.filter(
    (identity, index) => identities.indexOf(identity) !== index
  );
  if (duplicates.length > 0) {
    throw new Error(
      `Communication inventory repeats authoritative surfaces:\n${[
        ...new Set(duplicates),
      ].join("\n")}`
    );
  }
  const actions = entries.filter(({ kind }) => kind === "action");
  if (actions.length !== Object.keys(ACTION_CONTRACTS).length) {
    throw new Error(
      `Communication inventory expected ${Object.keys(ACTION_CONTRACTS).length} guarded action exports, found ${actions.length}`
    );
  }
  const external = entries.filter(({ kind }) => kind === "external");
  if (external.length !== Object.keys(EXTERNAL_CONTRACTS).length) {
    throw new Error(
      `Communication inventory expected ${Object.keys(EXTERNAL_CONTRACTS).length} communication route handlers, found ${external.length}`
    );
  }
  if (
    entries.some(
      (entry) =>
        entry.classification.state === "supported" &&
        (entry.operationKind === "excluded" ||
          entry.applicationCapability === null ||
          entry.confirmation === "excluded")
    )
  ) {
    throw new Error(
      "Communication inventory contains an unclassified supported entry"
    );
  }
}

export function generateCommunicationCapabilityInventory(
  repoRoot: string
): CommunicationEvryCapabilityInventory {
  const entries = [
    ...actionSurfaces(),
    ...routeSurfaces(repoRoot),
    ...rscReadSurfaces(repoRoot),
    ...communicationExternalSurfaces(repoRoot),
  ].toSorted((left, right) => compareStrings(left.identity, right.identity));
  assertBijection(entries);

  const byCapability = new Map<
    string,
    CommunicationEvryCapabilityInventory["capabilities"][number]
  >();
  for (const entry of entries) {
    if (entry.classification.state !== "supported") continue;
    if (
      entry.operationKind === "excluded" ||
      entry.applicationCapability === null ||
      entry.confirmation === "excluded"
    ) {
      throw new Error(
        `Communication inventory left ${entry.identity} unclassified`
      );
    }
    const capability = {
      identity: entry.capabilityIdentity,
      surfaceIdentities: [entry.identity],
      parityCapability: "communication" as const,
      domain: entry.domain,
      operationKind: entry.operationKind,
      applicationCapability: entry.applicationCapability,
      confirmation: entry.confirmation,
      mutationShape: entry.mutationShape,
    };
    const existing = byCapability.get(entry.capabilityIdentity);
    if (existing) {
      const { surfaceIdentities: _existingSurfaces, ...existingContract } =
        existing;
      const { surfaceIdentities: _newSurfaces, ...newContract } = capability;
      if (JSON.stringify(existingContract) !== JSON.stringify(newContract)) {
        throw new Error(
          `Communication capability ${entry.capabilityIdentity} has conflicting surfaces`
        );
      }
      byCapability.set(entry.capabilityIdentity, {
        ...existing,
        surfaceIdentities: [...existing.surfaceIdentities, entry.identity],
      });
      continue;
    }
    byCapability.set(entry.capabilityIdentity, capability);
  }

  const capabilities = [...byCapability.values()]
    .map((capability) => ({
      ...capability,
      surfaceIdentities: [...capability.surfaceIdentities].toSorted(
        compareStrings
      ),
    }))
    .toSorted((left, right) => compareStrings(left.identity, right.identity));
  const count = (kind: CommunicationEvrySurface["kind"]) =>
    entries.filter((entry) => entry.kind === kind).length;

  return {
    schemaVersion: 1,
    generatedBy: "pnpm evry:communication-inventory",
    authoritativeSources: {
      actions: "src/lib/auth/capability-map.ts",
      routes: "src/app/(dashboard)/communication/**/page.tsx",
      rscReads:
        "awaited @/lib/communication/* calls in dashboard server components",
      external: "Communication provider and RSVP route handlers",
    },
    capabilities,
    entries,
    summary: {
      actions: count("action"),
      routes: count("route"),
      rscReads: count("rsc_read"),
      externalExclusions: count("external"),
      productGaps: count("product_gap"),
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

export function generatedCommunicationInventoryPath(repoRoot: string): string {
  return path.join(repoRoot, GENERATED_INVENTORY);
}

export async function serializeCommunicationCapabilityInventory(
  inventory: CommunicationEvryCapabilityInventory,
  repoRoot: string
): Promise<string> {
  const outputPath = generatedCommunicationInventoryPath(repoRoot);
  const prettierConfig = await resolvePrettierConfig(outputPath);
  return formatWithPrettier(JSON.stringify(inventory), {
    ...prettierConfig,
    filepath: outputPath,
    parser: "json",
  });
}

export async function writeCommunicationCapabilityInventory(
  repoRoot: string,
  inventory: CommunicationEvryCapabilityInventory
): Promise<void> {
  writeFileSync(
    generatedCommunicationInventoryPath(repoRoot),
    await serializeCommunicationCapabilityInventory(inventory, repoRoot),
    "utf8"
  );
}

export async function assertCommunicationCapabilityInventoryCurrent(
  repoRoot: string,
  inventory: CommunicationEvryCapabilityInventory
): Promise<void> {
  const actual = readFileSync(
    generatedCommunicationInventoryPath(repoRoot),
    "utf8"
  );
  const expected = await serializeCommunicationCapabilityInventory(
    inventory,
    repoRoot
  );
  if (actual !== expected) {
    throw new Error(
      "Communication capability inventory is stale; run `pnpm evry:communication-inventory`"
    );
  }
}
