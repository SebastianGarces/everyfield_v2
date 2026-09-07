import inventoryDocument from "./inventory.generated.json";

import type { Capability } from "@/lib/auth/seat-rules";
import type { EvryAuthoritativeCapabilitySurface } from "@/lib/evry/eligibility/registry";

import {
  TEAMS_ACTION_CONTRACTS,
  TEAMS_RESPONSIBILITY_SEED_CONTRACT,
  type TeamsActionContract,
  type TeamsActionExport,
  type TeamsMutationShape,
  type TeamsOperationKind,
} from "./contracts";

export { TEAMS_ACTION_CONTRACTS } from "./contracts";
export type { TeamsActionContract, TeamsActionExport } from "./contracts";

type GeneratedCapability = Readonly<{
  identity: string;
  surfaceIdentities: readonly string[];
  parityCapability: "teams";
  domain: string;
  operationKind: TeamsOperationKind;
  applicationCapability: Capability;
  confirmation: "not_required" | "required";
  mutationShape: TeamsMutationShape | null;
}>;

type GeneratedEntry = Readonly<{
  identity: string;
  capabilityIdentity: string;
  operationKind: TeamsOperationKind | "excluded";
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
  "teams.read.candidates": {
    label: "Search team candidates",
    argumentKeys: ["query"],
  },
  "teams.read.detail": {
    label: "Review ministry team",
    argumentKeys: ["teamId"],
  },
  "teams.read.health": { label: "Review team health", argumentKeys: [] },
  "teams.read.list": { label: "List ministry teams", argumentKeys: ["status"] },
  "teams.read.meetings": {
    label: "List team meetings",
    argumentKeys: ["teamId"],
  },
  "teams.read.person-assignments": {
    label: "Review a person's ministry team assignments",
    argumentKeys: ["personId"],
  },
  "teams.read.person-training": {
    label: "Review a person's ministry training",
    argumentKeys: ["personId"],
  },
  "teams.read.responsibilities": {
    label: "List team responsibilities",
    argumentKeys: ["teamId"],
  },
  "teams.read.training": {
    label: "Review team training",
    argumentKeys: ["teamId"],
  },
} as const;

export type TeamsCapabilityMetadata = Readonly<{
  identity: string;
  domain: string;
  operationKind: TeamsOperationKind;
  applicationCapability: Capability;
  surfaceIdentities: readonly [string, ...string[]];
  label: string;
  actionLabel: string | null;
  argumentKeys: readonly string[];
  difficultToReverse: boolean;
  mutationShape: TeamsMutationShape | null;
}>;

const contracts = [
  ...Object.values(TEAMS_ACTION_CONTRACTS),
  TEAMS_RESPONSIBILITY_SEED_CONTRACT,
];
const effectByIdentity = new Map<string, TeamsActionContract>(
  contracts.map((contract) => [contract.operationId, contract])
);

function metadataFor(capability: GeneratedCapability): TeamsCapabilityMetadata {
  const [firstSurface, ...otherSurfaces] = capability.surfaceIdentities;
  if (!firstSurface)
    throw new Error(
      `Teams capability ${capability.identity} has no source surface`
    );
  const surfaceIdentities = Object.freeze([
    firstSurface,
    ...otherSurfaces,
  ]) as readonly [string, ...string[]];
  if (capability.operationKind === "effect") {
    const contract = effectByIdentity.get(capability.identity);
    if (!contract)
      throw new Error(
        `Teams effect ${capability.identity} has no closed contract`
      );
    return Object.freeze({
      ...capability,
      surfaceIdentities,
      label: contract.label,
      actionLabel: contract.actionLabel,
      argumentKeys: contract.argumentKeys,
      difficultToReverse: contract.difficultToReverse,
    });
  }
  const read = READ_METADATA[capability.identity as keyof typeof READ_METADATA];
  if (!read)
    throw new Error(`Teams read ${capability.identity} has no closed contract`);
  return Object.freeze({
    ...capability,
    surfaceIdentities,
    label: read.label,
    actionLabel: null,
    argumentKeys: Object.freeze([...read.argumentKeys]),
    difficultToReverse: false,
  });
}

export const TEAMS_CAPABILITIES: readonly TeamsCapabilityMetadata[] =
  Object.freeze(generated.capabilities.map(metadataFor));

const knownActionExports = new Set(
  generated.entries.flatMap((entry) => {
    if (
      !entry.identity.startsWith("action:") ||
      entry.classification.state !== "supported"
    )
      return [];
    const name = entry.identity.split(" → ")[1];
    return name ? [name] : [];
  })
);
for (const exportName of Object.keys(
  TEAMS_ACTION_CONTRACTS
) as TeamsActionExport[]) {
  if (!knownActionExports.has(exportName))
    throw new Error(`Stale Teams action contract: ${exportName}`);
}

export const TEAMS_AUTHORITATIVE_SURFACES: readonly EvryAuthoritativeCapabilitySurface[] =
  Object.freeze(
    generated.entries.flatMap((entry) => {
      if (
        entry.classification.state !== "supported" ||
        entry.operationKind === "excluded" ||
        entry.applicationCapability === null
      )
        return [];
      return [
        Object.freeze({
          identity: entry.identity,
          capabilityIdentity: entry.capabilityIdentity,
          parityCapability: "teams",
          operationKind: entry.operationKind,
          applicationCapability: entry.applicationCapability,
        }),
      ];
    })
  );
