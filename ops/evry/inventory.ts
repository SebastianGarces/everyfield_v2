import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  format as formatWithPrettier,
  resolveConfig as resolvePrettierConfig,
} from "prettier";

import { CAPABILITY_BY_EXPORT } from "../../src/lib/auth/capability-map";
import {
  ALL_CAPABILITIES,
  UNSEATED_EXPORTS,
  type Capability,
} from "../../src/lib/auth/seat-rules";
import {
  EVRY_EXCLUSION_REASONS,
  EVRY_UNREACHABLE_REASONS,
  type EvryActionSurface,
  type EvryParityCapability,
  type EvryParityClassification,
  type EvryParityEntry,
  type EvryParityInventory,
  type EvryParitySelector,
  type EvryRouteSurface,
  type EvrySourceSurface,
} from "../../src/lib/evry/capabilities/contract";
import { mainNavItems, type NavItem } from "../../src/lib/navigation";
import { SETTINGS_SECTIONS } from "../../src/lib/settings/sections";

const GENERATED_INVENTORY = path.join(
  "src",
  "lib",
  "evry",
  "capabilities",
  "inventory.generated.json"
);

const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function routePathFromPage(appRoot: string, page: string): string {
  const relativeDirectory = path.relative(appRoot, path.dirname(page));
  const routeSegments: string[] = [];

  for (const rawSegment of relativeDirectory.split(path.sep).filter(Boolean)) {
    if (rawSegment.startsWith("@")) continue;

    let segment = rawSegment;
    if (segment.startsWith("(...)")) {
      routeSegments.length = 0;
      segment = segment.slice("(...)".length);
    } else {
      let parentLevels = 0;
      while (segment.startsWith("(..)")) {
        parentLevels += 1;
        segment = segment.slice("(..)".length);
      }
      if (parentLevels > routeSegments.length) {
        throw new Error(
          `intercepting route climbs above the app root: ${toPosix(page)}`
        );
      }
      routeSegments.splice(routeSegments.length - parentLevels, parentLevels);

      if (segment.startsWith("(.)")) {
        segment = segment.slice("(.)".length);
      }
    }

    if (!segment) {
      throw new Error(
        `intercepting route marker has no target segment: ${toPosix(page)}`
      );
    }
    if (/^\(.+\)$/.test(segment)) continue;
    routeSegments.push(segment);
  }

  return routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`;
}

/** Every routable App Router `page.tsx`, including dynamic routes. */
export function collectRouteSurfaces(repoRoot: string): EvryRouteSurface[] {
  const appRoot = path.join(repoRoot, "src", "app");
  const pages: string[] = [];

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true }).toSorted(
      (a, b) => compareStrings(a.name, b.name)
    );
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        // Private folders are not routes. Route groups and parallel slots are
        // URL-transparent, but their nested pages still establish routes.
        if (entry.name.startsWith("_")) continue;
        visit(full);
      } else if (entry.isFile() && /^page\.tsx?$/.test(entry.name)) {
        pages.push(full);
      }
    }
  }

  visit(appRoot);

  const sourcesByPath = new Map<string, string[]>();
  for (const page of pages) {
    const routePath = routePathFromPage(appRoot, page);
    const sources = sourcesByPath.get(routePath) ?? [];
    sources.push(toPosix(path.relative(repoRoot, page)));
    sourcesByPath.set(routePath, sources);
  }

  return [...sourcesByPath.entries()]
    .map(([routePath, sources]) => ({
      kind: "route" as const,
      identity: `route:${routePath}`,
      path: routePath,
      sources: sources.toSorted(compareStrings),
    }))
    .toSorted((a, b) => compareStrings(a.identity, b.identity));
}

function actionParts(identity: string): { source: string; exportName: string } {
  const marker = " → ";
  const split = identity.lastIndexOf(marker);
  if (split < 0) throw new Error(`invalid action identity: ${identity}`);
  return {
    source: identity.slice(0, split),
    exportName: identity.slice(split + marker.length),
  };
}

type EvryActionExemption = NonNullable<EvryActionSurface["exemption"]>;

export type EvryActionRegistryInputs = Readonly<{
  guarded: Readonly<Record<string, string>>;
  exempt: Readonly<Record<string, EvryActionExemption>>;
}>;

const DEFAULT_ACTION_REGISTRIES: EvryActionRegistryInputs = {
  guarded: CAPABILITY_BY_EXPORT,
  exempt: UNSEATED_EXPORTS,
};

/** The checked-in guarded and exempt export registries are the action source. */
export function collectActionSurfaces(
  registries: EvryActionRegistryInputs = DEFAULT_ACTION_REGISTRIES
): EvryActionSurface[] {
  const knownCapabilities = new Set<Capability>(ALL_CAPABILITIES);
  const guarded = Object.entries(registries.guarded).map(
    ([identity, capability]) => {
      if (!knownCapabilities.has(capability as Capability)) {
        throw new Error(
          `${identity} names unknown application capability ${capability}`
        );
      }
      const { source, exportName } = actionParts(identity);
      return {
        kind: "action" as const,
        identity: `action:${identity}`,
        source,
        exportName,
        applicationCapability: capability as Capability,
        exemption: null,
      };
    }
  );

  const exempt = Object.entries(registries.exempt).map(
    ([identity, exemption]) => {
      const { source, exportName } = actionParts(identity);
      return {
        kind: "action" as const,
        identity: `action:${identity}`,
        source,
        exportName,
        applicationCapability: null,
        exemption,
      };
    }
  );

  const surfaces = [...guarded, ...exempt].toSorted((a, b) =>
    compareStrings(a.identity, b.identity)
  );
  const identities = surfaces.map((surface) => surface.identity);
  const duplicate = identities.find(
    (identity, index) => identities.indexOf(identity) !== index
  );
  if (duplicate)
    throw new Error(`duplicate action registry identity: ${duplicate}`);
  return surfaces;
}

function parityFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).toSorted(
    (a, b) => compareStrings(a.name, b.name)
  )) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...parityFiles(full));
    else if (entry.isFile() && entry.name === "parity.ts") found.push(full);
  }
  return found;
}

/** Discover module contributions; there is deliberately no aggregate import. */
export async function loadParityCapabilities(
  repoRoot: string
): Promise<EvryParityCapability[]> {
  const root = path.join(repoRoot, "src", "lib", "evry", "capabilities");
  const capabilities: EvryParityCapability[] = [];

  for (const file of parityFiles(root)) {
    const module = (await import(pathToFileURL(file).href)) as {
      PARITY_CAPABILITIES?: unknown;
    };
    if (!Array.isArray(module.PARITY_CAPABILITIES)) {
      throw new Error(
        `${toPosix(path.relative(repoRoot, file))} must export PARITY_CAPABILITIES`
      );
    }
    capabilities.push(
      ...(module.PARITY_CAPABILITIES as EvryParityCapability[])
    );
  }

  return capabilities;
}

function flattenNavigation(items: readonly NavItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.href && !item.isDisabled ? [item.href] : []),
    ...flattenNavigation(item.items ?? []),
  ]);
}

export type EvryAuthoritativeSources = Readonly<{
  routes: readonly EvryRouteSurface[];
  actions: readonly EvryActionSurface[];
  registries: EvryParityInventory["registries"];
}>;

export function collectAuthoritativeSources(
  repoRoot: string
): EvryAuthoritativeSources {
  return {
    routes: collectRouteSurfaces(repoRoot),
    actions: collectActionSurfaces(),
    registries: {
      plantNavigation: flattenNavigation(mainNavItems).toSorted(compareStrings),
      settingsSections: SETTINGS_SECTIONS.map(({ id, label, keywords }) => ({
        id,
        label,
        keywords: [...keywords].toSorted(compareStrings),
      })).toSorted((a, b) => compareStrings(a.id, b.id)),
    },
  };
}

function prefixMatches(value: string, prefix: string): boolean {
  return value === prefix || value.startsWith(`${prefix}/`);
}

function selectorMatches(
  selector: EvryParitySelector,
  surface: EvrySourceSurface
): boolean {
  switch (selector.kind) {
    case "route":
      return (
        surface.kind === "route" &&
        (selector.match === "exact"
          ? surface.path === selector.path
          : prefixMatches(surface.path, selector.path))
      );
    case "action-source":
      return (
        surface.kind === "action" &&
        (selector.match === "exact"
          ? surface.source === selector.source
          : prefixMatches(surface.source, selector.source))
      );
    case "action-identity":
      return (
        surface.kind === "action" && surface.identity === selector.identity
      );
    case "application-capability":
      return (
        surface.kind === "action" &&
        surface.applicationCapability === selector.capability
      );
  }
}

function assertClassification(
  capability: EvryParityCapability
): EvryParityClassification {
  const { classification } = capability;
  if (classification.state === "supported") return classification;
  if (
    classification.state === "excluded" &&
    (EVRY_EXCLUSION_REASONS as readonly string[]).includes(
      classification.reason
    )
  ) {
    return classification;
  }
  if (
    classification.state === "unreachable" &&
    (EVRY_UNREACHABLE_REASONS as readonly string[]).includes(
      classification.reason
    )
  ) {
    return classification;
  }
  throw new Error(`${capability.id} has an invalid parity classification`);
}

/** Classify every source surface exactly once, or refuse to generate. */
export function buildParityInventory(
  sources: EvryAuthoritativeSources,
  capabilities: readonly EvryParityCapability[]
): EvryParityInventory {
  const capabilityIds = capabilities.map(({ id }) => id);
  const duplicateIds = capabilityIds.filter(
    (id, index) => capabilityIds.indexOf(id) !== index
  );
  if (duplicateIds.length > 0) {
    throw new Error(
      `duplicate Evry capability identity:\n${[...new Set(duplicateIds)]
        .toSorted(compareStrings)
        .join("\n")}`
    );
  }

  for (const capability of capabilities) {
    if (!capability.id || capability.selectors.length === 0) {
      throw new Error(
        `${capability.id || "<empty>"} must declare at least one selector`
      );
    }
    assertClassification(capability);
  }

  const surfaces: EvrySourceSurface[] = [...sources.routes, ...sources.actions];
  const entries: EvryParityEntry[] = [];
  const failures: string[] = [];
  const matchedCapabilities = new Set<string>();

  for (const surface of surfaces) {
    const matches = capabilities.filter((capability) =>
      capability.selectors.some((selector) =>
        selectorMatches(selector, surface)
      )
    );
    if (matches.length === 0) {
      failures.push(`unclassified ${surface.identity}`);
      continue;
    }
    if (matches.length > 1) {
      failures.push(
        `multiply classified ${surface.identity}: ${matches
          .map(({ id }) => id)
          .toSorted(compareStrings)
          .join(", ")}`
      );
      continue;
    }

    const capability = matches[0];
    matchedCapabilities.add(capability.id);
    entries.push({
      ...surface,
      parityCapability: capability.id,
      classification: capability.classification,
    });
  }

  for (const capability of capabilities) {
    if (!matchedCapabilities.has(capability.id)) {
      failures.push(`unused capability declaration ${capability.id}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Evry parity inventory refused:\n${failures.join("\n")}`);
  }

  const sortedEntries = entries.toSorted((a, b) =>
    compareStrings(a.identity, b.identity)
  );
  const count = (state: EvryParityClassification["state"]): number =>
    sortedEntries.filter((entry) => entry.classification.state === state)
      .length;

  return {
    schemaVersion: 1,
    generatedBy: "pnpm evry:inventory",
    authoritativeSources: {
      routes: "src/app/**/page.tsx",
      guardedActions: "src/lib/auth/capability-map.ts",
      exemptActions: "src/lib/auth/seat-rules.ts#UNSEATED_EXPORTS",
    },
    registries: sources.registries,
    capabilities: capabilities
      .map(({ id, classification }) => ({ id, classification }))
      .toSorted((a, b) => compareStrings(a.id, b.id)),
    entries: sortedEntries,
    summary: {
      routes: sources.routes.length,
      actions: sources.actions.length,
      supported: count("supported"),
      excluded: count("excluded"),
      unreachable: count("unreachable"),
      unclassified: 0,
    },
  };
}

export async function serializeParityInventory(
  inventory: EvryParityInventory,
  repoRoot: string
): Promise<string> {
  const outputPath = generatedInventoryPath(repoRoot);
  const prettierConfig = await resolvePrettierConfig(outputPath);
  return formatWithPrettier(JSON.stringify(inventory), {
    ...prettierConfig,
    filepath: outputPath,
    parser: "json",
  });
}

export async function generateParityInventory(
  repoRoot: string
): Promise<EvryParityInventory> {
  const [sources, capabilities] = await Promise.all([
    Promise.resolve(collectAuthoritativeSources(repoRoot)),
    loadParityCapabilities(repoRoot),
  ]);
  return buildParityInventory(sources, capabilities);
}

export function generatedInventoryPath(repoRoot: string): string {
  return path.join(repoRoot, GENERATED_INVENTORY);
}

export async function writeParityInventory(
  repoRoot: string,
  inventory: EvryParityInventory
): Promise<void> {
  writeFileSync(
    generatedInventoryPath(repoRoot),
    await serializeParityInventory(inventory, repoRoot),
    "utf8"
  );
}

export async function assertParityInventoryCurrent(
  repoRoot: string,
  inventory: EvryParityInventory
): Promise<void> {
  const generated = readFileSync(generatedInventoryPath(repoRoot), "utf8");
  const expected = await serializeParityInventory(inventory, repoRoot);
  if (generated !== expected) {
    throw new Error(
      "Evry parity inventory is stale; run `pnpm evry:inventory` and commit the result"
    );
  }
}

/** Read-only helper for callers that need to verify the artifact exists. */
export function hasGeneratedInventory(repoRoot: string): boolean {
  try {
    return statSync(generatedInventoryPath(repoRoot)).isFile();
  } catch {
    return false;
  }
}
