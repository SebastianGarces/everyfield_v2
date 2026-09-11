import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  format as formatWithPrettier,
  resolveConfig as resolvePrettierConfig,
} from "prettier";

import type { Capability } from "../../src/lib/auth/seat-rules";
import {
  TASK_ACTION_CONTRACTS,
  type TaskActionExport,
  type TaskMutationShape,
  type TaskOperationKind,
} from "../../src/lib/evry/capabilities/tasks/contracts";
import { collectActionSurfaces, collectRouteSurfaces } from "./inventory";
import {
  discoverTaskPageReadOperations,
  discoverTaskActionIdentities,
  TASKS_DISCOVERED_READ_EXCLUSIONS,
  taskReadIdentity,
} from "./tasks-source-discovery";

const GENERATED_INVENTORY = path.join(
  "src",
  "lib",
  "evry",
  "capabilities",
  "tasks",
  "inventory.generated.json"
);

type TaskReadDomain =
  | "detail"
  | "list"
  | "phase_template"
  | "planning"
  | "templates";
type TaskDomain =
  | TaskReadDomain
  | "checklist"
  | "follow_up"
  | "lifecycle"
  | "list"
  | "template";

type SupportedContract = Readonly<{
  capabilityIdentity: string;
  domain: TaskDomain;
  operationKind: TaskOperationKind;
  mutationShape: TaskMutationShape | null;
  applicationCapability: Capability;
}>;

export type TaskEvrySurface = Readonly<{
  kind: "action" | "route" | "rsc_read";
  identity: string;
  source: string;
  exportName: string | null;
  capabilityIdentity: string | null;
  domain: TaskDomain | "boundary";
  operationKind: TaskOperationKind | "excluded";
  applicationCapability: Capability | null;
  confirmation: "not_required" | "required" | "excluded";
  mutationShape: TaskMutationShape | null;
  classification:
    | Readonly<{ state: "supported" }>
    | Readonly<{ state: "excluded"; reason: "shared_boundary" }>;
}>;

export type TaskEvryCapabilityInventory = Readonly<{
  schemaVersion: 1;
  generatedBy: "pnpm evry:tasks-inventory";
  authoritativeSources: Readonly<{
    actions: "src/lib/auth/capability-map.ts";
    routes: "src/app/(dashboard)/tasks/**/page.tsx";
    rscReads: "AST-discovered awaited operations in the Task RSC import graph";
  }>;
  capabilities: readonly Readonly<{
    identity: string;
    surfaceIdentities: readonly string[];
    parityCapability: "tasks";
    domain: TaskDomain;
    operationKind: TaskOperationKind;
    applicationCapability: Capability;
    confirmation: "not_required" | "required";
    mutationShape: TaskMutationShape | null;
  }>[];
  entries: readonly TaskEvrySurface[];
  summary: Readonly<{
    actions: number;
    routes: number;
    rscReads: number;
    exclusions: number;
    readCapabilities: number;
    effectCapabilities: number;
    unclassified: 0;
  }>;
}>;

const read = taskReadIdentity;

const READ_CONTRACTS = new Map<string, SupportedContract>([
  [
    read("src/app/(dashboard)/tasks/page.tsx", "getTaskCounts"),
    {
      capabilityIdentity: "tasks.read.counts",
      domain: "list",
      operationKind: "read",
      mutationShape: null,
      applicationCapability: "read",
    },
  ],
  ...[
    read("src/app/(dashboard)/tasks/page.tsx", "listFollowUpAssignees"),
    read("src/app/(dashboard)/tasks/page.tsx", "listFollowUpContacts"),
    read("src/app/(dashboard)/tasks/page.tsx", "listOpenFollowUpTasks"),
  ].map((identity): readonly [string, SupportedContract] => [
    identity,
    {
      capabilityIdentity: "tasks.read.follow-up-ownership",
      domain: "list",
      operationKind: "read",
      mutationShape: null,
      applicationCapability: "read",
    },
  ]),
  [
    read("src/app/(dashboard)/tasks/page.tsx", "readTaskListPage"),
    {
      capabilityIdentity: "tasks.read.list",
      domain: "list",
      operationKind: "read",
      mutationShape: null,
      applicationCapability: "read",
    },
  ],
  ...[
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "db.select"),
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "getTask"),
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "listFollowUpAssignees"),
    read(
      "src/app/(dashboard)/tasks/[id]/page.tsx",
      "listPrerequisiteCandidates"
    ),
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "listSubtasks"),
    read("src/app/(dashboard)/tasks/[id]/page.tsx", "listTaskPrerequisites"),
  ].map((identity): readonly [string, SupportedContract] => [
    identity,
    {
      capabilityIdentity: "tasks.read.detail",
      domain: "detail",
      operationKind: "read",
      mutationShape: null,
      applicationCapability: "read",
    },
  ]),
  ...[
    read("src/app/(dashboard)/tasks/new/page.tsx", "db.select"),
    read("src/app/(dashboard)/tasks/new/page.tsx", "listFollowUpAssignees"),
    read(
      "src/app/(dashboard)/tasks/new/page.tsx",
      "listPrerequisiteCandidates"
    ),
  ].map((identity): readonly [string, SupportedContract] => [
    identity,
    {
      capabilityIdentity: "tasks.read.planning-options",
      domain: "planning",
      operationKind: "read",
      mutationShape: null,
      applicationCapability: "tasks.write",
    },
  ]),
  [
    read(
      "src/components/tasks/phase-template-prompt.tsx",
      "readPhaseTemplatePrompt"
    ),
    {
      capabilityIdentity: "tasks.read.phase-template-prompt",
      domain: "phase_template",
      operationKind: "read",
      mutationShape: null,
      applicationCapability: "phase.signal",
    },
  ],
  [
    read(
      "src/app/(dashboard)/tasks/templates/page.tsx",
      "getCurrentUserChurch"
    ),
    {
      capabilityIdentity: "tasks.read.templates",
      domain: "templates",
      operationKind: "read",
      mutationShape: null,
      applicationCapability: "tasks.write",
    },
  ],
]);

const ROUTE_CONTRACTS = new Map<string, SupportedContract>([
  [
    "/tasks",
    {
      capabilityIdentity: "tasks.read.list",
      domain: "list",
      operationKind: "read",
      mutationShape: null,
      applicationCapability: "read",
    },
  ],
  [
    "/tasks/[id]",
    {
      capabilityIdentity: "tasks.read.detail",
      domain: "detail",
      operationKind: "read",
      mutationShape: null,
      applicationCapability: "read",
    },
  ],
  [
    "/tasks/new",
    {
      capabilityIdentity: "tasks.read.planning-options",
      domain: "planning",
      operationKind: "read",
      mutationShape: null,
      applicationCapability: "tasks.write",
    },
  ],
  [
    "/tasks/templates",
    {
      capabilityIdentity: "tasks.read.templates",
      domain: "templates",
      operationKind: "read",
      mutationShape: null,
      applicationCapability: "tasks.write",
    },
  ],
]);

function supportedSurface(
  input: Pick<TaskEvrySurface, "kind" | "identity" | "source" | "exportName">,
  contract: SupportedContract
): TaskEvrySurface {
  return {
    ...input,
    capabilityIdentity: contract.capabilityIdentity,
    domain: contract.domain,
    operationKind: contract.operationKind,
    applicationCapability: contract.applicationCapability,
    confirmation:
      contract.operationKind === "effect" ? "required" : "not_required",
    mutationShape: contract.mutationShape,
    classification: { state: "supported" },
  };
}

function actionEntries(repoRoot: string): TaskEvrySurface[] {
  const guarded = collectActionSurfaces().filter(({ source }) =>
    source.startsWith("src/app/(dashboard)/tasks/")
  );
  const discovered = discoverTaskActionIdentities(repoRoot);
  const guardedIdentities = guarded.map(({ identity }) => identity).toSorted();
  if (JSON.stringify(guardedIdentities) !== JSON.stringify(discovered)) {
    const guardedSet = new Set(guardedIdentities);
    const discoveredSet = new Set(discovered);
    const unguarded = discovered.filter(
      (identity) => !guardedSet.has(identity)
    );
    const stale = guardedIdentities.filter(
      (identity) => !discoveredSet.has(identity)
    );
    throw new Error(
      `Task action authority drift: unguarded=[${unguarded.join(", ")}], stale=[${stale.join(", ")}]`
    );
  }
  return guarded.map((surface) => {
    const contract =
      TASK_ACTION_CONTRACTS[surface.exportName as TaskActionExport];
    if (!contract || surface.applicationCapability === null) {
      throw new Error(
        `Task inventory has no action contract for ${surface.identity}`
      );
    }
    return supportedSurface(
      {
        kind: "action",
        identity: surface.identity,
        source: surface.source,
        exportName: surface.exportName,
      },
      {
        capabilityIdentity: contract.operationId,
        domain: contract.domain,
        operationKind: contract.operationKind,
        mutationShape: contract.mutationShape,
        applicationCapability: surface.applicationCapability,
      }
    );
  });
}

function routeEntries(repoRoot: string): TaskEvrySurface[] {
  return collectRouteSurfaces(repoRoot)
    .filter(
      ({ path: routePath }) =>
        routePath === "/tasks" || routePath.startsWith("/tasks/")
    )
    .map((surface) => {
      const contract = ROUTE_CONTRACTS.get(surface.path);
      if (!contract) {
        throw new Error(
          `Task inventory has no route contract for ${surface.identity}`
        );
      }
      return supportedSurface(
        {
          kind: "route",
          identity: surface.identity,
          source: surface.sources.join(","),
          exportName: null,
        },
        contract
      );
    });
}

function readEntries(repoRoot: string): TaskEvrySurface[] {
  const exclusions = new Map(
    TASKS_DISCOVERED_READ_EXCLUSIONS.map(({ identity, reason }) => [
      identity,
      reason,
    ])
  );
  return discoverTaskPageReadOperations(repoRoot).map((identity) => {
    const contract = READ_CONTRACTS.get(identity);
    if (contract) {
      return supportedSurface(
        {
          kind: "rsc_read",
          identity,
          source:
            identity.slice("read-operation:".length).split(" → ")[0] ?? "",
          exportName: identity.split(" → ")[1] ?? null,
        },
        contract
      );
    }
    if (!exclusions.has(identity)) {
      throw new Error(
        `Task inventory has no RSC-read contract for ${identity}`
      );
    }
    return {
      kind: "rsc_read" as const,
      identity,
      source: identity.slice("read-operation:".length).split(" → ")[0] ?? "",
      exportName: identity.split(" → ")[1] ?? null,
      capabilityIdentity: null,
      domain: "boundary" as const,
      operationKind: "excluded" as const,
      applicationCapability: null,
      confirmation: "excluded" as const,
      mutationShape: null,
      classification: {
        state: "excluded" as const,
        reason: "shared_boundary" as const,
      },
    };
  });
}

function assertBijection(entries: readonly TaskEvrySurface[]): void {
  const identities = entries.map(({ identity }) => identity);
  const duplicates = identities.filter(
    (identity, index) => identities.indexOf(identity) !== index
  );
  if (duplicates.length > 0) {
    throw new Error(
      `Task inventory repeats surfaces:\n${[...new Set(duplicates)].join("\n")}`
    );
  }
  if (
    entries.filter(({ kind }) => kind === "action").length !==
    Object.keys(TASK_ACTION_CONTRACTS).length
  ) {
    throw new Error(
      "Task inventory action contract count does not match the guarded exports"
    );
  }
  if (
    entries.some(
      (entry) =>
        entry.classification.state === "supported" &&
        (entry.capabilityIdentity === null ||
          entry.applicationCapability === null ||
          entry.operationKind === "excluded" ||
          entry.confirmation === "excluded")
    )
  ) {
    throw new Error("Task inventory contains an unclassified supported entry");
  }
}

export function generateTaskCapabilityInventory(
  repoRoot: string
): TaskEvryCapabilityInventory {
  const entries = [
    ...actionEntries(repoRoot),
    ...routeEntries(repoRoot),
    ...readEntries(repoRoot),
  ].toSorted((left, right) => left.identity.localeCompare(right.identity));
  assertBijection(entries);

  const byCapability = new Map<
    string,
    TaskEvryCapabilityInventory["capabilities"][number]
  >();
  for (const entry of entries) {
    if (
      entry.classification.state !== "supported" ||
      entry.capabilityIdentity === null ||
      entry.applicationCapability === null ||
      entry.operationKind === "excluded" ||
      entry.confirmation === "excluded"
    ) {
      continue;
    }
    const next = {
      identity: entry.capabilityIdentity,
      surfaceIdentities: [entry.identity],
      parityCapability: "tasks" as const,
      domain: entry.domain as TaskDomain,
      operationKind: entry.operationKind,
      applicationCapability: entry.applicationCapability,
      confirmation: entry.confirmation,
      mutationShape: entry.mutationShape,
    };
    const existing = byCapability.get(entry.capabilityIdentity);
    if (!existing) {
      byCapability.set(entry.capabilityIdentity, next);
      continue;
    }
    const { surfaceIdentities: _existing, ...existingContract } = existing;
    const { surfaceIdentities: _next, ...nextContract } = next;
    if (JSON.stringify(existingContract) !== JSON.stringify(nextContract)) {
      throw new Error(
        `Task capability ${entry.capabilityIdentity} has conflicting surfaces`
      );
    }
    byCapability.set(entry.capabilityIdentity, {
      ...existing,
      surfaceIdentities: [...existing.surfaceIdentities, entry.identity],
    });
  }

  const capabilities = [...byCapability.values()]
    .map((capability) => ({
      ...capability,
      surfaceIdentities: [...capability.surfaceIdentities].toSorted(),
    }))
    .toSorted((left, right) => left.identity.localeCompare(right.identity));
  const count = (kind: TaskEvrySurface["kind"]) =>
    entries.filter((entry) => entry.kind === kind).length;

  return {
    schemaVersion: 1,
    generatedBy: "pnpm evry:tasks-inventory",
    authoritativeSources: {
      actions: "src/lib/auth/capability-map.ts",
      routes: "src/app/(dashboard)/tasks/**/page.tsx",
      rscReads:
        "AST-discovered awaited operations in the Task RSC import graph",
    },
    capabilities,
    entries,
    summary: {
      actions: count("action"),
      routes: count("route"),
      rscReads: count("rsc_read"),
      exclusions: entries.filter(
        ({ classification }) => classification.state === "excluded"
      ).length,
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

export function generatedTaskInventoryPath(repoRoot: string): string {
  return path.join(repoRoot, GENERATED_INVENTORY);
}

export async function serializeTaskCapabilityInventory(
  inventory: TaskEvryCapabilityInventory,
  repoRoot: string
): Promise<string> {
  const outputPath = generatedTaskInventoryPath(repoRoot);
  const prettierConfig = await resolvePrettierConfig(outputPath);
  return formatWithPrettier(JSON.stringify(inventory), {
    ...prettierConfig,
    filepath: outputPath,
    parser: "json",
  });
}

export async function writeTaskCapabilityInventory(
  repoRoot: string,
  inventory: TaskEvryCapabilityInventory
): Promise<void> {
  writeFileSync(
    generatedTaskInventoryPath(repoRoot),
    await serializeTaskCapabilityInventory(inventory, repoRoot),
    "utf8"
  );
}

export async function assertTaskCapabilityInventoryCurrent(
  repoRoot: string,
  inventory: TaskEvryCapabilityInventory
): Promise<void> {
  const actual = readFileSync(generatedTaskInventoryPath(repoRoot), "utf8");
  const expected = await serializeTaskCapabilityInventory(inventory, repoRoot);
  if (actual !== expected) {
    throw new Error(
      "Task capability inventory is stale; run `pnpm evry:tasks-inventory`"
    );
  }
}
