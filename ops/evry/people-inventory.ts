import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  format as formatWithPrettier,
  resolveConfig as resolvePrettierConfig,
} from "prettier";

import type { Capability } from "../../src/lib/auth/seat-rules";
import { collectActionSurfaces, collectRouteSurfaces } from "./inventory";

const GENERATED_INVENTORY = path.join(
  "src",
  "lib",
  "evry",
  "capabilities",
  "people",
  "inventory.generated.json"
);

const PEOPLE_ACTION_ROOT = "src/app/(dashboard)/people/";
const PEOPLE_APP_ROOT = path.join("src", "app", "(dashboard)", "people");
const PEOPLE_COMPONENT_ROOT = path.join("src", "components", "people");
const PEOPLE_API_ROOT = path.join("src", "app", "api", "people");

const FIXTURE_CLASSES = [
  "selection",
  "arguments",
  "confirmation",
  "execution",
  "idempotency",
  "failure",
] as const;

export type PeopleEvryOperationKind = "read" | "effect";
export type PeopleEvryMutationShape =
  | "single_create"
  | "single_update"
  | "single_delete"
  | "association_add"
  | "association_remove"
  | "bulk_reorder"
  | "bulk_propagate"
  | "bulk_import"
  | "file_write"
  | "compound_write";

export type PeopleEvrySurface = Readonly<{
  kind: "action" | "route" | "route_handler" | "rsc_read" | "product_gap";
  identity: string;
  source: string;
  exportName: string | null;
  capabilityIdentity: string;
  domain: string;
  operationKind: PeopleEvryOperationKind | "excluded";
  applicationCapability: Capability | null;
  confirmation: "not_required" | "required" | "excluded";
  mutationShape: PeopleEvryMutationShape | null;
  classification:
    | Readonly<{ state: "supported" }>
    | Readonly<{
        state: "excluded";
        reason: "owning_product_gap" | "ui_navigation_only";
      }>;
}>;

export type PeopleEvryCapabilityInventory = Readonly<{
  schemaVersion: 1;
  generatedBy: "pnpm evry:people-inventory";
  authoritativeSources: Readonly<{
    actions: "src/lib/auth/capability-map.ts";
    routes: "src/app/(dashboard)/people/**/{page,layout}.tsx";
    routeHandlers: "src/app/api/people/**/route.ts";
    rscReads: "async @/lib/people/* imports in People route and server-component modules";
  }>;
  capabilities: readonly Readonly<{
    identity: string;
    surfaceIdentities: readonly string[];
    parityCapability: "people";
    domain: string;
    operationKind: PeopleEvryOperationKind;
    applicationCapability: Capability;
    confirmation: "not_required" | "required";
    mutationShape: PeopleEvryMutationShape | null;
    fixtureClasses: typeof FIXTURE_CLASSES;
  }>[];
  entries: readonly PeopleEvrySurface[];
  summary: Readonly<{
    actions: number;
    routes: number;
    routeHandlers: number;
    rscReads: number;
    productGaps: number;
    readCapabilities: number;
    effectCapabilities: number;
    unclassified: 0;
  }>;
}>;

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

function kebab(value: string): string {
  return value
    .replace(/Action$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function actionDomain(source: string, exportName: string): string {
  if (exportName === "checkForDuplicatesAction") return "duplicates";
  if (source.endsWith("/activity-actions.ts")) return "notes";
  if (source.endsWith("/assessment-actions.ts")) return "assessments";
  if (source.endsWith("/household-actions.ts")) return "households";
  if (source.endsWith("/pipeline-actions.ts")) return "stages";
  if (source.endsWith("/skill-actions.ts")) return "skills";
  if (source.endsWith("/tag-actions.ts")) return "tags";
  if (source.endsWith("/import-export-actions.ts")) {
    return exportName.includes("Export") ? "exports" : "imports";
  }
  return "people";
}

const MUTATION_SHAPE_BY_EXPORT = {
  addNoteAction: "single_create",
  addSkillAction: "single_create",
  addToHouseholdAction: "association_add",
  assignTagAction: "association_add",
  changeStatusAction: "single_update",
  changeStatusWithReasonAction: "single_update",
  createAssessmentAction: "compound_write",
  createCommitmentAction: "compound_write",
  createHouseholdWithHeadAction: "compound_write",
  createInterviewAction: "compound_write",
  createPersonAction: "single_create",
  createTagAction: "single_create",
  deleteHouseholdAction: "single_delete",
  deleteNoteAction: "single_delete",
  deletePersonAction: "single_delete",
  deleteTagAction: "single_delete",
  editNoteAction: "single_update",
  executeBulkImportAction: "bulk_import",
  propagateAddressAction: "bulk_propagate",
  quickAddPersonAction: "single_create",
  removeFromHouseholdAction: "association_remove",
  removePersonPhotoAction: "file_write",
  removeSkillAction: "single_delete",
  removeTagAction: "association_remove",
  reorderPipelineAction: "bulk_reorder",
  updateHouseholdAction: "single_update",
  updatePersonAction: "single_update",
  updateSkillAction: "single_update",
  updateTagAction: "single_update",
  uploadPersonPhotoAction: "file_write",
} as const satisfies Readonly<Record<string, PeopleEvryMutationShape>>;

const READ_ACTION_OVERRIDES = new Set(["previewImportAction"]);

function actionSurfaces(): PeopleEvrySurface[] {
  return collectActionSurfaces()
    .filter(
      (surface) =>
        surface.source.startsWith(PEOPLE_ACTION_ROOT) &&
        surface.applicationCapability !== null
    )
    .map((surface): PeopleEvrySurface => {
      const domain = actionDomain(surface.source, surface.exportName);
      const operationKind =
        surface.applicationCapability === "read" ||
        READ_ACTION_OVERRIDES.has(surface.exportName)
          ? "read"
          : "effect";
      const mutationShape =
        operationKind === "effect"
          ? (MUTATION_SHAPE_BY_EXPORT[
              surface.exportName as keyof typeof MUTATION_SHAPE_BY_EXPORT
            ] ?? null)
          : null;
      if (operationKind === "effect" && mutationShape === null) {
        throw new Error(
          `People inventory has no mutation shape for ${surface.identity}`
        );
      }
      return {
        kind: "action",
        identity: surface.identity,
        source: surface.source,
        exportName: surface.exportName,
        capabilityIdentity: `people.crm.${domain}.${kebab(surface.exportName)}`,
        domain,
        operationKind,
        applicationCapability: surface.applicationCapability,
        confirmation: operationKind === "effect" ? "required" : "not_required",
        mutationShape,
        classification: { state: "supported" },
      };
    });
}

const ROUTE_READ_CAPABILITY = {
  "/people": "people.crm.people.list-people",
  "/people/[id]": "people.crm.people.get-person",
  "/people/[id]/activity": "people.crm.notes.get-activities",
  "/people/[id]/assessments": "people.crm.assessments.get-assessments",
  "/people/[id]/assessments/commitment": "people.crm.people.get-person",
  "/people/[id]/assessments/interview": "people.crm.people.get-person",
  "/people/[id]/assessments/new": "people.crm.people.get-person",
  "/people/[id]/communication": "people.crm.people.get-person",
  "/people/[id]/teams": "people.crm.people.get-person",
} as const satisfies Readonly<Record<string, string>>;

function routeSurfaces(repoRoot: string): PeopleEvrySurface[] {
  return collectRouteSurfaces(repoRoot)
    .filter(
      (surface) =>
        surface.path === "/people" || surface.path.startsWith("/people/")
    )
    .map((surface): PeopleEvrySurface => {
      const capabilityIdentity =
        ROUTE_READ_CAPABILITY[
          surface.path as keyof typeof ROUTE_READ_CAPABILITY
        ];
      if (!capabilityIdentity) {
        return {
          kind: "route",
          identity: surface.identity,
          source: surface.sources.join(","),
          exportName: null,
          capabilityIdentity: "people.crm.ui.navigation",
          domain: "routes",
          operationKind: "excluded",
          applicationCapability: null,
          confirmation: "excluded",
          mutationShape: null,
          classification: {
            state: "excluded",
            reason: "ui_navigation_only",
          },
        };
      }
      return {
        kind: "route",
        identity: surface.identity,
        source: surface.sources.join(","),
        exportName: null,
        capabilityIdentity,
        domain: capabilityIdentity.split(".")[2] ?? "people",
        operationKind: "read",
        applicationCapability: "read",
        confirmation: "not_required",
        mutationShape: null,
        classification: { state: "supported" },
      };
    });
}

function routeHandlerSurfaces(repoRoot: string): PeopleEvrySurface[] {
  const apiRoot = path.join(repoRoot, PEOPLE_API_ROOT);
  const appRoot = path.join(repoRoot, "src", "app");
  return walk(apiRoot).flatMap((file): PeopleEvrySurface[] => {
    if (path.basename(file) !== "route.ts") return [];
    const source = readFileSync(file, "utf8");
    const methods = [
      ...source.matchAll(
        /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g
      ),
    ].map((match) => match[1]);
    const routePath = `/${toPosix(path.relative(appRoot, path.dirname(file)))}`;
    return methods.map((method) => ({
      kind: "route_handler",
      identity: `handler:${method}:${routePath}`,
      source: toPosix(path.relative(repoRoot, file)),
      exportName: method,
      capabilityIdentity:
        method === "GET" && routePath === "/api/people/[personId]/photo"
          ? "people.crm.people.get-person-photo"
          : `people.crm.handlers.${method.toLowerCase()}.${kebab(routePath)}`,
      domain: "people",
      operationKind: method === "GET" ? "read" : "effect",
      applicationCapability: method === "GET" ? "read" : "people.write",
      confirmation: method === "GET" ? "not_required" : "required",
      mutationShape: null,
      classification: { state: "supported" },
    }));
  });
}

function exportedAsyncNames(source: string): Set<string> {
  return new Set([
    ...[
      ...source.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)\b/g),
    ].map((match) => match[1]),
    ...[
      ...source.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=\s*cache\s*\(/g),
    ].map((match) => match[1]),
  ]);
}

function readDomain(modulePath: string): string {
  const moduleName = path.basename(modulePath);
  if (moduleName === "activity") return "notes";
  if (moduleName === "assessments" || moduleName === "commitments") {
    return "assessments";
  }
  if (moduleName === "household") return "households";
  if (moduleName === "pipeline") return "stages";
  if (moduleName === "skills") return "skills";
  if (moduleName === "tags") return "tags";
  if (moduleName === "duplicates") return "duplicates";
  if (moduleName === "import") return "imports";
  if (moduleName === "export") return "exports";
  return "people";
}

function rscReadSurfaces(repoRoot: string): PeopleEvrySurface[] {
  const candidates = [
    ...walk(path.join(repoRoot, PEOPLE_APP_ROOT)),
    ...walk(path.join(repoRoot, PEOPLE_COMPONENT_ROOT)),
  ].filter(
    (file) =>
      /\.[jt]sx?$/.test(file) &&
      !/\.(?:test|proof)\.[jt]sx?$/.test(file) &&
      !file.endsWith("-actions.ts") &&
      !file.endsWith("/actions.ts")
  );
  const asyncByModule = new Map<string, Set<string>>();
  const entries: PeopleEvrySurface[] = [];

  for (const file of candidates) {
    const source = readFileSync(file, "utf8");
    if (/^\s*["']use client["'];/m.test(source)) continue;
    const caller = toPosix(path.relative(repoRoot, file));
    for (const match of source.matchAll(
      /import\s+(?!type\s+)\{([^}]*)\}\s+from\s+["'](@\/lib\/people\/[A-Za-z0-9_.-]+)["'];/g
    )) {
      const imported = match[1];
      const modulePath = match[2];
      const moduleFile = path.join(
        repoRoot,
        `${modulePath.replace(/^@\//, "src/")}.ts`
      );
      let asyncNames = asyncByModule.get(moduleFile);
      if (!asyncNames) {
        asyncNames = exportedAsyncNames(readFileSync(moduleFile, "utf8"));
        asyncByModule.set(moduleFile, asyncNames);
      }
      for (const specifier of imported.split(",")) {
        const normalized = specifier.trim().replace(/^type\s+/, "");
        if (!normalized) continue;
        const exportName = normalized.split(/\s+as\s+/)[0]?.trim();
        if (!exportName || !asyncNames.has(exportName)) continue;
        const domain = readDomain(modulePath);
        entries.push({
          kind: "rsc_read",
          identity: `rsc-read:${caller} → ${modulePath}#${exportName}`,
          source: caller,
          exportName,
          capabilityIdentity: `people.crm.${domain}.${kebab(exportName)}`,
          domain,
          operationKind: "read",
          applicationCapability: "read",
          confirmation: "not_required",
          mutationShape: null,
          classification: { state: "supported" },
        });
      }
    }
  }
  return entries;
}

const PRODUCT_GAPS: readonly PeopleEvrySurface[] = [
  {
    kind: "product_gap",
    identity: "product-gap:people.duplicates.merge",
    source: "src/lib/people/duplicates.ts",
    exportName: null,
    capabilityIdentity: "people.crm.duplicates.merge",
    domain: "duplicates",
    operationKind: "excluded",
    applicationCapability: null,
    confirmation: "excluded",
    mutationShape: null,
    classification: { state: "excluded", reason: "owning_product_gap" },
  },
];

function assertBijection(entries: readonly PeopleEvrySurface[]): void {
  const identities = entries.map(({ identity }) => identity);
  const duplicateSources = identities.filter(
    (identity, index) => identities.indexOf(identity) !== index
  );
  if (duplicateSources.length > 0) {
    throw new Error(
      `People inventory repeats authoritative surfaces:\n${[
        ...new Set(duplicateSources),
      ].join("\n")}`
    );
  }

  const actions = entries.filter(({ kind }) => kind === "action");
  if (actions.length !== 41) {
    throw new Error(
      `People inventory expected 41 guarded action exports, found ${actions.length}`
    );
  }
  const imports = actions.filter(({ source }) =>
    source.endsWith("/import-export-actions.ts")
  );
  if (imports.length !== 4) {
    throw new Error(
      `People inventory expected 4 import/export actions, found ${imports.length}`
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
      "People inventory contains an unclassified supported entry"
    );
  }
}

export function generatePeopleCapabilityInventory(
  repoRoot: string
): PeopleEvryCapabilityInventory {
  const entries = [
    ...actionSurfaces(),
    ...routeSurfaces(repoRoot),
    ...routeHandlerSurfaces(repoRoot),
    ...rscReadSurfaces(repoRoot),
    ...PRODUCT_GAPS,
  ].toSorted((left, right) => compareStrings(left.identity, right.identity));
  assertBijection(entries);

  const byCapability = new Map<
    string,
    Omit<
      PeopleEvryCapabilityInventory["capabilities"][number],
      "fixtureClasses"
    >
  >();
  for (const entry of entries) {
    if (entry.classification.state !== "supported") continue;
    if (
      entry.operationKind === "excluded" ||
      entry.applicationCapability === null ||
      entry.confirmation === "excluded"
    ) {
      throw new Error(`People inventory left ${entry.identity} unclassified`);
    }
    const capability = {
      identity: entry.capabilityIdentity,
      surfaceIdentities: [entry.identity],
      parityCapability: "people" as const,
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
          `People capability ${entry.capabilityIdentity} has conflicting surfaces`
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
      fixtureClasses: FIXTURE_CLASSES,
    }))
    .toSorted((left, right) => compareStrings(left.identity, right.identity));
  const count = (kind: PeopleEvrySurface["kind"]) =>
    entries.filter((entry) => entry.kind === kind).length;

  return {
    schemaVersion: 1,
    generatedBy: "pnpm evry:people-inventory",
    authoritativeSources: {
      actions: "src/lib/auth/capability-map.ts",
      routes: "src/app/(dashboard)/people/**/{page,layout}.tsx",
      routeHandlers: "src/app/api/people/**/route.ts",
      rscReads:
        "async @/lib/people/* imports in People route and server-component modules",
    },
    capabilities,
    entries,
    summary: {
      actions: count("action"),
      routes: count("route"),
      routeHandlers: count("route_handler"),
      rscReads: count("rsc_read"),
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

export function generatedPeopleInventoryPath(repoRoot: string): string {
  return path.join(repoRoot, GENERATED_INVENTORY);
}

export async function serializePeopleCapabilityInventory(
  inventory: PeopleEvryCapabilityInventory,
  repoRoot: string
): Promise<string> {
  const outputPath = generatedPeopleInventoryPath(repoRoot);
  const prettierConfig = await resolvePrettierConfig(outputPath);
  return formatWithPrettier(JSON.stringify(inventory), {
    ...prettierConfig,
    filepath: outputPath,
    parser: "json",
  });
}

export async function writePeopleCapabilityInventory(
  repoRoot: string,
  inventory: PeopleEvryCapabilityInventory
): Promise<void> {
  writeFileSync(
    generatedPeopleInventoryPath(repoRoot),
    await serializePeopleCapabilityInventory(inventory, repoRoot),
    "utf8"
  );
}

export async function assertPeopleCapabilityInventoryCurrent(
  repoRoot: string,
  inventory: PeopleEvryCapabilityInventory
): Promise<void> {
  const actual = readFileSync(generatedPeopleInventoryPath(repoRoot), "utf8");
  const expected = await serializePeopleCapabilityInventory(
    inventory,
    repoRoot
  );
  if (actual !== expected) {
    throw new Error(
      "People capability inventory is stale; run `pnpm evry:people-inventory`"
    );
  }
}
