import inventoryDocument from "./inventory.generated.json";

import type { Capability } from "@/lib/auth/seat-rules";
import type { EvryAuthoritativeCapabilitySurface } from "@/lib/evry/eligibility/registry";

import {
  TASK_ACTION_CONTRACTS,
  type TaskActionContract,
  type TaskActionExport,
  type TaskMutationShape,
  type TaskOperationKind,
} from "./contracts";

export { TASK_ACTION_CONTRACTS } from "./contracts";
export type { TaskActionContract, TaskActionExport } from "./contracts";

export type TaskCapabilityMetadata = Readonly<{
  identity: string;
  domain: string;
  operationKind: TaskOperationKind;
  applicationCapability: Capability;
  surfaceIdentities: readonly [string, ...string[]];
  label: string;
  actionLabel: string | null;
  argumentKeys: readonly string[];
  difficultToReverse: boolean;
  mutationShape: TaskMutationShape | null;
}>;

type GeneratedCapability = Readonly<{
  identity: string;
  surfaceIdentities: readonly string[];
  parityCapability: "tasks";
  domain: string;
  operationKind: TaskOperationKind;
  applicationCapability: Capability;
  confirmation: "not_required" | "required";
  mutationShape: TaskMutationShape | null;
}>;

type GeneratedEntry = Readonly<{
  identity: string;
  capabilityIdentity: string | null;
  operationKind: TaskOperationKind | "excluded";
  applicationCapability: Capability | null;
  classification:
    | Readonly<{ state: "supported" }>
    | Readonly<{ state: "excluded"; reason: string }>;
}>;

const generated = inventoryDocument as Readonly<{
  capabilities: readonly GeneratedCapability[];
  entries: readonly GeneratedEntry[];
}>;

const READ_METADATA = {
  "tasks.read.counts": {
    label: "Review task counts",
    argumentKeys: ["view", "status", "priority", "category"],
  },
  "tasks.read.detail": {
    label: "Review task details",
    argumentKeys: ["taskId", "detailSection", "cursor"],
  },
  "tasks.read.list": {
    label: "List tasks",
    argumentKeys: [
      "view",
      "showCompleted",
      "status",
      "priority",
      "category",
      "cursor",
    ],
  },
  "tasks.read.follow-up-ownership": {
    label: "Review follow-up ownership",
    argumentKeys: ["section", "cursor"],
  },
  "tasks.read.phase-template-prompt": {
    label: "Review phase checklist prompt",
    argumentKeys: [],
  },
  "tasks.read.planning-options": {
    label: "Review task planning options",
    argumentKeys: ["taskId", "optionType", "search", "cursor"],
  },
  "tasks.read.templates": {
    label: "List task checklist templates",
    argumentKeys: ["phase"],
  },
} as const;

const effectContractByIdentity = new Map<string, TaskActionContract>(
  Object.values(TASK_ACTION_CONTRACTS).map((contract) => [
    contract.operationId,
    contract,
  ])
);

function metadataFor(capability: GeneratedCapability): TaskCapabilityMetadata {
  if (capability.surfaceIdentities.length === 0) {
    throw new Error(
      `Task capability ${capability.identity} has no source surface`
    );
  }
  if (capability.operationKind === "effect") {
    const contract = effectContractByIdentity.get(capability.identity);
    if (!contract || contract.operationKind !== "effect") {
      throw new Error(
        `Task effect ${capability.identity} has no closed contract`
      );
    }
    return Object.freeze({
      ...capability,
      surfaceIdentities: Object.freeze([
        ...capability.surfaceIdentities,
      ]) as readonly [string, ...string[]],
      label: contract.label,
      actionLabel: contract.actionLabel,
      argumentKeys: contract.argumentKeys,
      difficultToReverse: contract.difficultToReverse,
    });
  }
  const read = READ_METADATA[capability.identity as keyof typeof READ_METADATA];
  if (!read) {
    throw new Error(`Task read ${capability.identity} has no closed contract`);
  }
  return Object.freeze({
    ...capability,
    surfaceIdentities: Object.freeze([
      ...capability.surfaceIdentities,
    ]) as readonly [string, ...string[]],
    label: read.label,
    actionLabel: null,
    argumentKeys: Object.freeze([...read.argumentKeys]),
    difficultToReverse: false,
  });
}

/** Generated semantic catalog; no route/action/read is inferred at runtime. */
export const TASK_CAPABILITIES: readonly TaskCapabilityMetadata[] =
  Object.freeze(generated.capabilities.map(metadataFor));

const knownExports = new Set(
  generated.entries.flatMap((entry) => {
    if (
      !entry.identity.startsWith("action:") ||
      entry.capabilityIdentity === null
    ) {
      return [];
    }
    const exportName = entry.identity.split(" → ")[1];
    return exportName ? [exportName] : [];
  })
);
for (const exportName of Object.keys(
  TASK_ACTION_CONTRACTS
) as TaskActionExport[]) {
  if (!knownExports.has(exportName)) {
    throw new Error(`Stale Task action contract: ${exportName}`);
  }
}

export const TASK_AUTHORITATIVE_SURFACES: readonly EvryAuthoritativeCapabilitySurface[] =
  Object.freeze(
    generated.entries.flatMap((entry) => {
      if (
        entry.classification.state !== "supported" ||
        entry.capabilityIdentity === null ||
        entry.applicationCapability === null ||
        entry.operationKind === "excluded"
      ) {
        return [];
      }
      return [
        Object.freeze({
          identity: entry.identity,
          capabilityIdentity: entry.capabilityIdentity,
          parityCapability: "tasks",
          operationKind: entry.operationKind,
          applicationCapability: entry.applicationCapability,
        }),
      ];
    })
  );
