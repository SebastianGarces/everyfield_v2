import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  format as formatWithPrettier,
  resolveConfig as resolvePrettierConfig,
} from "prettier";

import {
  MEETINGS_CAPABILITY_SURFACES,
  MEETINGS_EXCLUDED_OPERATIONS,
} from "../../src/lib/evry/capabilities/meetings/catalog";
import { MEETINGS_OPERATION_REGISTRATIONS } from "../../src/lib/evry/capabilities/meetings/registrations";
import {
  CLASSIFIED_MEETINGS_ROUTE_IDENTITIES,
  discoverMeetingsActionIdentities,
  discoverMeetingsPageReadOperations,
  meetingsDiscoveredReadExclusions,
} from "./meetings-source-discovery";
import { collectRouteSurfaces } from "./inventory";

const GENERATED_INVENTORY = path.join(
  "src",
  "lib",
  "evry",
  "capabilities",
  "meetings",
  "inventory.generated.json"
);

const FIXTURE_CLASSES = [
  "selection",
  "arguments",
  "confirmation",
  "execution",
  "idempotency",
  "failure",
] as const;

type MeetingsInventoryEntry = Readonly<{
  identity: string;
  kind: "action" | "route" | "read_operation" | "excluded_operation";
  capabilityIdentity: string | null;
  parityCapability: "meetings";
  operationKind: "read" | "effect" | "excluded";
  applicationCapability: "read" | "meetings.write" | null;
  confirmation: "not_required" | "required" | "excluded";
  classification:
    | Readonly<{ state: "supported" }>
    | Readonly<{
        state: "excluded";
        reason: "no_authenticated_surface" | "shared_boundary_or_presentation";
      }>;
}>;

export type MeetingsCapabilityInventory = Readonly<{
  schemaVersion: 1;
  generatedBy: "pnpm evry:meetings-inventory";
  authoritativeSources: Readonly<{
    actions: "src/lib/auth/capability-map.ts";
    routes: "src/app/(dashboard)/{meetings,teams/[teamId]/meetings}/**/page.tsx";
    reads: "server data imports used by authenticated Meetings pages";
  }>;
  capabilities: readonly Readonly<{
    identity: string;
    surfaceIdentities: readonly string[];
    parityCapability: "meetings";
    operationKind: "read" | "effect";
    applicationCapability: "read" | "meetings.write";
    confirmation: "not_required" | "required";
    label: string;
    actionLabel: string | null;
    argumentKeys: readonly string[];
    difficultToReverse: boolean;
    fixtureClasses: typeof FIXTURE_CLASSES;
  }>[];
  entries: readonly MeetingsInventoryEntry[];
  summary: Readonly<{
    actions: number;
    routes: number;
    readOperations: number;
    exclusions: number;
    readCapabilities: number;
    effectCapabilities: number;
    unclassified: 0;
  }>;
}>;

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function assertExactSourceCoverage(input: {
  subject: string;
  discovered: readonly string[];
  supported: readonly string[];
  excluded?: readonly string[];
}): void {
  const supported = new Set(input.supported);
  const excluded = new Set(input.excluded ?? []);
  const multiplyClassified = input.supported.filter((identity) =>
    excluded.has(identity)
  );
  const classified = new Set([...supported, ...excluded]);
  const unclassified = input.discovered.filter(
    (identity) => !classified.has(identity)
  );
  const discovered = new Set(input.discovered);
  const stale = [...classified].filter((identity) => !discovered.has(identity));
  if (
    multiplyClassified.length > 0 ||
    unclassified.length > 0 ||
    stale.length > 0
  ) {
    throw new Error(
      `Meetings ${input.subject} authority drift: unclassified=[${unclassified.join(", ")}], multiply-classified=[${multiplyClassified.join(", ")}], stale=[${stale.join(", ")}]`
    );
  }
}

function isMeetingsRoute(routePath: string): boolean {
  return (
    routePath === "/meetings" ||
    routePath.startsWith("/meetings/") ||
    routePath === "/teams/[teamId]/meetings" ||
    routePath.startsWith("/teams/[teamId]/meetings/")
  );
}

export function generateMeetingsCapabilityInventory(
  repoRoot = process.cwd()
): MeetingsCapabilityInventory {
  const authoritativeKinds = new Map(
    MEETINGS_CAPABILITY_SURFACES.map((surface) => [
      surface.identity,
      surface.exportName === null ? ("route" as const) : ("action" as const),
    ])
  );
  const entries: MeetingsInventoryEntry[] = [];
  const registeredSurfaces = MEETINGS_OPERATION_REGISTRATIONS.flatMap(
    ({ surfaceIdentities }) => surfaceIdentities
  );
  assertExactSourceCoverage({
    subject: "action",
    discovered: discoverMeetingsActionIdentities(repoRoot),
    supported: registeredSurfaces.filter((identity) =>
      identity.startsWith("action:")
    ),
  });
  assertExactSourceCoverage({
    subject: "route",
    discovered: collectRouteSurfaces(repoRoot)
      .filter(
        ({ identity, path: routePath }) =>
          isMeetingsRoute(routePath) ||
          CLASSIFIED_MEETINGS_ROUTE_IDENTITIES.includes(identity)
      )
      .map(({ identity }) => identity),
    supported: registeredSurfaces.filter((identity) =>
      identity.startsWith("route:")
    ),
  });

  const discoveredReads = discoverMeetingsPageReadOperations(repoRoot);
  const mappedReads = MEETINGS_OPERATION_REGISTRATIONS.flatMap(
    ({ surfaceIdentities }) => surfaceIdentities
  ).filter((identity) => identity.startsWith("read-operation:"));
  const discoveredReadExclusions = meetingsDiscoveredReadExclusions(repoRoot);
  const excludedReads = new Set(
    discoveredReadExclusions.map(({ identity }) => identity)
  );
  assertExactSourceCoverage({
    subject: "page-read",
    discovered: discoveredReads,
    supported: mappedReads,
    excluded: [...excludedReads],
  });

  for (const registration of MEETINGS_OPERATION_REGISTRATIONS) {
    if (
      registration.applicationCapability !== "read" &&
      registration.applicationCapability !== "meetings.write"
    ) {
      throw new Error(
        `Meetings capability has foreign application permission: ${registration.identity}`
      );
    }
    for (const identity of registration.surfaceIdentities) {
      const kind = authoritativeKinds.get(identity) ?? "read_operation";
      if (
        kind === "read_operation" &&
        !identity.startsWith("read-operation:")
      ) {
        throw new Error(`Unknown Meetings surface kind: ${identity}`);
      }
      entries.push({
        identity,
        kind,
        capabilityIdentity: registration.identity,
        parityCapability: "meetings",
        operationKind: registration.operationKind,
        applicationCapability: registration.applicationCapability,
        confirmation:
          registration.operationKind === "effect" ? "required" : "not_required",
        classification: { state: "supported" },
      });
    }
  }
  entries.push(
    ...MEETINGS_EXCLUDED_OPERATIONS.map(
      ({ identity }): MeetingsInventoryEntry => ({
        identity,
        kind: "excluded_operation",
        capabilityIdentity: null,
        parityCapability: "meetings",
        operationKind: "excluded",
        applicationCapability: null,
        confirmation: "excluded",
        classification: {
          state: "excluded",
          reason: "no_authenticated_surface",
        },
      })
    ),
    ...discoveredReadExclusions.map(
      ({ identity }): MeetingsInventoryEntry => ({
        identity,
        kind: "excluded_operation",
        capabilityIdentity: null,
        parityCapability: "meetings",
        operationKind: "excluded",
        applicationCapability: null,
        confirmation: "excluded",
        classification: {
          state: "excluded",
          reason: "shared_boundary_or_presentation",
        },
      })
    )
  );
  entries.sort((left, right) => compareStrings(left.identity, right.identity));

  const identities = entries.map(({ identity }) => identity);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Meetings inventory repeats an authoritative surface");
  }

  const capabilities = MEETINGS_OPERATION_REGISTRATIONS.map((registration) => ({
    identity: registration.identity,
    surfaceIdentities: [...registration.surfaceIdentities].toSorted(
      compareStrings
    ),
    parityCapability: "meetings" as const,
    operationKind: registration.operationKind,
    applicationCapability: registration.applicationCapability as
      | "read"
      | "meetings.write",
    confirmation:
      registration.operationKind === "effect"
        ? ("required" as const)
        : ("not_required" as const),
    label: registration.label,
    actionLabel: registration.actionLabel,
    argumentKeys: [...registration.argumentKeys],
    difficultToReverse: registration.difficultToReverse,
    fixtureClasses: FIXTURE_CLASSES,
  })).toSorted((left, right) => compareStrings(left.identity, right.identity));

  const count = (kind: MeetingsInventoryEntry["kind"]) =>
    entries.filter((entry) => entry.kind === kind).length;
  return {
    schemaVersion: 1,
    generatedBy: "pnpm evry:meetings-inventory",
    authoritativeSources: {
      actions: "src/lib/auth/capability-map.ts",
      routes:
        "src/app/(dashboard)/{meetings,teams/[teamId]/meetings}/**/page.tsx",
      reads: "server data imports used by authenticated Meetings pages",
    },
    capabilities,
    entries,
    summary: {
      actions: count("action"),
      routes: count("route"),
      readOperations: count("read_operation"),
      exclusions: count("excluded_operation"),
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

export function generatedMeetingsInventoryPath(repoRoot: string): string {
  return path.join(repoRoot, GENERATED_INVENTORY);
}

export async function serializeMeetingsCapabilityInventory(
  inventory: MeetingsCapabilityInventory,
  repoRoot: string
): Promise<string> {
  const outputPath = generatedMeetingsInventoryPath(repoRoot);
  const prettierConfig = await resolvePrettierConfig(outputPath);
  return formatWithPrettier(JSON.stringify(inventory), {
    ...prettierConfig,
    filepath: outputPath,
    parser: "json",
  });
}

export async function writeMeetingsCapabilityInventory(
  repoRoot: string,
  inventory: MeetingsCapabilityInventory
): Promise<void> {
  writeFileSync(
    generatedMeetingsInventoryPath(repoRoot),
    await serializeMeetingsCapabilityInventory(inventory, repoRoot),
    "utf8"
  );
}

export async function assertMeetingsCapabilityInventoryCurrent(
  repoRoot: string,
  inventory: MeetingsCapabilityInventory
): Promise<void> {
  const actual = readFileSync(generatedMeetingsInventoryPath(repoRoot), "utf8");
  const expected = await serializeMeetingsCapabilityInventory(
    inventory,
    repoRoot
  );
  if (actual !== expected) {
    throw new Error(
      "Meetings capability inventory is stale; run `pnpm evry:meetings-inventory`"
    );
  }
}
