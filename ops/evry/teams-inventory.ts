import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  format as formatWithPrettier,
  resolveConfig as resolvePrettierConfig,
} from "prettier";

import type { Capability } from "../../src/lib/auth/seat-rules";
import {
  TEAMS_ACTION_CONTRACTS,
  TEAMS_RESPONSIBILITY_SEED_CONTRACT,
  type TeamsMutationShape,
  type TeamsOperationKind,
} from "../../src/lib/evry/capabilities/teams/contracts";
import { collectActionSurfaces, collectRouteSurfaces } from "./inventory";

const GENERATED_INVENTORY = path.join(
  "src",
  "lib",
  "evry",
  "capabilities",
  "teams",
  "inventory.generated.json"
);
const ACTION_SOURCE = "src/app/(dashboard)/teams/actions.ts";
const ROUTE_ROOT = path.join("src", "app", "(dashboard)", "teams");
const FIXTURE_CLASSES = [
  "selection",
  "arguments",
  "confirmation",
  "execution",
  "idempotency",
  "failure",
] as const;

type Classification =
  | Readonly<{ state: "supported" }>
  | Readonly<{ state: "excluded"; reason: "ui_navigation_only" }>;

export type TeamsEvrySurface = Readonly<{
  kind: "action" | "route" | "rsc_operation";
  identity: string;
  source: string;
  exportName: string | null;
  capabilityIdentity: string;
  domain: string;
  operationKind: TeamsOperationKind | "excluded";
  applicationCapability: Capability | null;
  confirmation: "not_required" | "required" | "excluded";
  mutationShape: TeamsMutationShape | null;
  classification: Classification;
}>;

export type TeamsEvryCapabilityInventory = Readonly<{
  schemaVersion: 1;
  generatedBy: "pnpm evry:teams-inventory";
  authoritativeSources: Readonly<{
    actions: "src/lib/auth/capability-map.ts";
    routes: "src/app/(dashboard)/teams/**/{page,layout}.tsx";
    rscOperations: "called Teams/People/Meetings service imports that return Teams-owned data";
  }>;
  capabilities: readonly Readonly<{
    identity: string;
    surfaceIdentities: readonly string[];
    parityCapability: "teams";
    domain: string;
    operationKind: TeamsOperationKind;
    applicationCapability: Capability;
    confirmation: "not_required" | "required";
    mutationShape: TeamsMutationShape | null;
    fixtureClasses: typeof FIXTURE_CLASSES;
  }>[];
  entries: readonly TeamsEvrySurface[];
  summary: Readonly<{
    actions: number;
    routes: number;
    rscOperations: number;
    readCapabilities: number;
    effectCapabilities: number;
    unclassified: 0;
  }>;
}>;

const compare = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;
const toPosix = (value: string) => value.split(path.sep).join("/");

const ROUTE_CAPABILITY = {
  "/teams": "teams.read.list",
  "/teams/[teamId]": "teams.read.detail",
  "/teams/[teamId]/meetings": "teams.read.meetings",
  "/teams/[teamId]/responsibilities": "teams.read.responsibilities",
  "/teams/[teamId]/training": "teams.read.training",
  "/teams/health": "teams.read.health",
  "/teams/org-chart": "teams.read.list",
} as const;

const RSC_CAPABILITY = {
  getAllTeamsHealth: "teams.read.health",
  getStaffingSummary: "teams.read.list",
  getTeam: "teams.read.detail",
  getTeamCountsForPeople: "teams.read.candidates",
  getPersonTeams: "teams.read.person-assignments",
  getPersonTraining: "teams.read.person-training",
  getTrainingMatrix: "teams.read.training",
  listMeetings: "teams.read.meetings",
  listPeople: "teams.read.candidates",
  listResponsibilities: TEAMS_RESPONSIBILITY_SEED_CONTRACT.operationId,
  listTeams: "teams.read.list",
  listTrainingPrograms: "teams.read.training",
} as const;

const READ_METADATA = {
  "teams.read.candidates": {
    domain: "members",
    label: "Search team candidates",
  },
  "teams.read.detail": { domain: "teams", label: "Review ministry team" },
  "teams.read.health": { domain: "teams", label: "Review team health" },
  "teams.read.list": { domain: "teams", label: "List ministry teams" },
  "teams.read.meetings": { domain: "meetings", label: "List team meetings" },
  "teams.read.person-assignments": {
    domain: "members",
    label: "Review a person's ministry team assignments",
  },
  "teams.read.person-training": {
    domain: "training",
    label: "Review a person's ministry training",
  },
  "teams.read.responsibilities": {
    domain: "responsibilities",
    label: "List team responsibilities",
  },
  "teams.read.training": { domain: "training", label: "Review team training" },
} as const;

function contractFor(identity: string) {
  return [
    ...Object.values(TEAMS_ACTION_CONTRACTS),
    TEAMS_RESPONSIBILITY_SEED_CONTRACT,
  ].find(({ operationId }) => operationId === identity);
}

function fieldsFor(identity: string) {
  const contract = contractFor(identity);
  if (contract) {
    return {
      domain: contract.domain,
      operationKind: contract.operationKind,
      applicationCapability:
        contract.operationKind === "read" ||
        identity === TEAMS_RESPONSIBILITY_SEED_CONTRACT.operationId
          ? ("read" as const)
          : ("teams.write" as const),
      confirmation:
        contract.operationKind === "read"
          ? ("not_required" as const)
          : ("required" as const),
      mutationShape: contract.mutationShape,
    };
  }
  const read = READ_METADATA[identity as keyof typeof READ_METADATA];
  if (!read) throw new Error(`Teams inventory has no contract for ${identity}`);
  return {
    domain: read.domain,
    operationKind: "read" as const,
    applicationCapability: "read" as const,
    confirmation: "not_required" as const,
    mutationShape: null,
  };
}

function actionEntries(): TeamsEvrySurface[] {
  const contracts = TEAMS_ACTION_CONTRACTS as Readonly<
    Record<
      string,
      (typeof TEAMS_ACTION_CONTRACTS)[keyof typeof TEAMS_ACTION_CONTRACTS]
    >
  >;
  const entries = collectActionSurfaces()
    .filter(({ source }) => source === ACTION_SOURCE)
    .map((surface): TeamsEvrySurface => {
      const contract = contracts[surface.exportName];
      if (!contract) {
        throw new Error(
          `Unclassified Teams action export: ${surface.identity}`
        );
      }
      if (surface.applicationCapability === null) {
        throw new Error(
          `Teams action lost its application capability: ${surface.identity}`
        );
      }
      return {
        kind: "action",
        identity: surface.identity,
        source: surface.source,
        exportName: surface.exportName,
        capabilityIdentity: contract.operationId,
        domain: contract.domain,
        operationKind: contract.operationKind,
        applicationCapability: surface.applicationCapability,
        confirmation:
          contract.operationKind === "effect" ? "required" : "not_required",
        mutationShape: contract.mutationShape,
        classification: { state: "supported" },
      };
    });
  const found = new Set(entries.map(({ exportName }) => exportName));
  for (const exportName of Object.keys(contracts)) {
    if (!found.has(exportName))
      throw new Error(`Stale Teams action contract: ${exportName}`);
  }
  return entries;
}

function routeEntries(repoRoot: string): TeamsEvrySurface[] {
  return collectRouteSurfaces(repoRoot)
    .filter(
      ({ path: routePath }) =>
        routePath === "/teams" || routePath.startsWith("/teams/")
    )
    .map((surface): TeamsEvrySurface => {
      const identity =
        ROUTE_CAPABILITY[surface.path as keyof typeof ROUTE_CAPABILITY];
      if (!identity) {
        return {
          kind: "route",
          identity: surface.identity,
          source: surface.sources.join(","),
          exportName: null,
          capabilityIdentity: "teams.ui.navigation",
          domain: "teams",
          operationKind: "excluded",
          applicationCapability: null,
          confirmation: "excluded",
          mutationShape: null,
          classification: { state: "excluded", reason: "ui_navigation_only" },
        };
      }
      return {
        kind: "route",
        identity: surface.identity,
        source: surface.sources.join(","),
        exportName: null,
        capabilityIdentity: identity,
        ...fieldsFor(identity),
        classification: { state: "supported" },
      };
    });
}

function rscEntries(repoRoot: string): TeamsEvrySurface[] {
  const root = path.join(repoRoot, ROUTE_ROOT);
  const files = collectRouteSurfaces(repoRoot)
    .filter(
      ({ path: routePath }) =>
        routePath === "/teams" || routePath.startsWith("/teams/")
    )
    .flatMap(({ sources }) => sources)
    .concat([
      "src/app/(dashboard)/teams/[teamId]/layout.tsx",
      "src/app/(dashboard)/teams/layout.tsx",
      "src/app/(dashboard)/people/[id]/teams/page.tsx",
      "src/app/(dashboard)/meetings/new/page.tsx",
    ])
    .filter((source, index, values) => values.indexOf(source) === index)
    .filter(
      (source) =>
        source.startsWith(toPosix(path.relative(repoRoot, root))) ||
        source === "src/app/(dashboard)/people/[id]/teams/page.tsx" ||
        source === "src/app/(dashboard)/meetings/new/page.tsx"
    );
  return files.flatMap((source): TeamsEvrySurface[] => {
    const body = readFileSync(path.join(repoRoot, source), "utf8");
    if (
      /import\s*\(\s*["']@\/lib\/(?:ministry-teams\/service|people\/service|meetings\/service)["']\s*\)/.test(
        body
      ) ||
      /import\s+\*\s+as\s+\w+\s+from\s+["']@\/lib\/(?:ministry-teams\/service|people\/service|meetings\/service)["']/.test(
        body
      )
    ) {
      throw new Error(
        `Teams RSC inventory does not permit namespace or dynamic service imports: ${source}`
      );
    }
    const imported = new Map<string, string>();
    for (const match of body.matchAll(
      /import\s+(?!type\s+)\{([^}]*)\}\s+from\s+["']@\/lib\/(?:ministry-teams\/service|people\/service|meetings\/service)["'];/g
    )) {
      for (const binding of match[1]?.split(",") ?? []) {
        const [exportName, localName] = binding.trim().split(/\s+as\s+/);
        if (exportName)
          imported.set((localName ?? exportName).trim(), exportName.trim());
      }
    }
    return [...imported].flatMap(
      ([localName, exportName]): TeamsEvrySurface[] => {
        if (!new RegExp(`\\b${localName}\\s*\\(`).test(body)) return [];
        const identity =
          RSC_CAPABILITY[exportName as keyof typeof RSC_CAPABILITY];
        if (!identity)
          throw new Error(
            `Unclassified Teams RSC service operation: ${source} → ${exportName}`
          );
        if (exportName === "listResponsibilities") {
          return [
            {
              kind: "rsc_operation",
              identity: `rsc-effect:${source} → listResponsibilities:first-view-seed`,
              source,
              exportName,
              capabilityIdentity:
                TEAMS_RESPONSIBILITY_SEED_CONTRACT.operationId,
              ...fieldsFor(TEAMS_RESPONSIBILITY_SEED_CONTRACT.operationId),
              classification: { state: "supported" },
            },
            {
              kind: "rsc_operation",
              identity: `rsc-read:${source} → listResponsibilities:returned-rows`,
              source,
              exportName,
              capabilityIdentity: "teams.read.responsibilities",
              ...fieldsFor("teams.read.responsibilities"),
              classification: { state: "supported" },
            },
          ];
        }
        return [
          {
            kind: "rsc_operation",
            identity: `rsc-operation:${source} → ${exportName}`,
            source,
            exportName,
            capabilityIdentity: identity,
            ...fieldsFor(identity),
            classification: { state: "supported" },
          },
        ];
      }
    );
  });
}

export function generateTeamsCapabilityInventory(
  repoRoot: string
): TeamsEvryCapabilityInventory {
  const entries = [
    ...actionEntries(),
    ...routeEntries(repoRoot),
    ...rscEntries(repoRoot),
  ].toSorted((left, right) => compare(left.identity, right.identity));
  const supported = entries.filter(
    (entry) => entry.classification.state === "supported"
  );
  const grouped = new Map<string, TeamsEvrySurface[]>();
  for (const entry of supported) {
    const group = grouped.get(entry.capabilityIdentity) ?? [];
    group.push(entry);
    grouped.set(entry.capabilityIdentity, group);
  }
  const capabilities = [...grouped.entries()]
    .toSorted(([left], [right]) => compare(left, right))
    .map(([identity, surfaces]) => {
      const first = surfaces[0];
      if (
        !first ||
        first.operationKind === "excluded" ||
        first.applicationCapability === null
      )
        throw new Error(`Invalid Teams capability ${identity}`);
      if (
        surfaces.some(
          (surface) =>
            surface.operationKind !== first.operationKind ||
            surface.applicationCapability !== first.applicationCapability
        )
      )
        throw new Error(
          `Teams capability ${identity} has inconsistent surfaces`
        );
      return {
        identity,
        surfaceIdentities: surfaces.map(({ identity: surface }) => surface),
        parityCapability: "teams" as const,
        domain: first.domain,
        operationKind: first.operationKind,
        applicationCapability: first.applicationCapability,
        confirmation: first.confirmation as "not_required" | "required",
        mutationShape: first.mutationShape,
        fixtureClasses: FIXTURE_CLASSES,
      };
    });
  return {
    schemaVersion: 1,
    generatedBy: "pnpm evry:teams-inventory",
    authoritativeSources: {
      actions: "src/lib/auth/capability-map.ts",
      routes: "src/app/(dashboard)/teams/**/{page,layout}.tsx",
      rscOperations:
        "called Teams/People/Meetings service imports that return Teams-owned data",
    },
    capabilities,
    entries,
    summary: {
      actions: entries.filter(({ kind }) => kind === "action").length,
      routes: entries.filter(({ kind }) => kind === "route").length,
      rscOperations: entries.filter(({ kind }) => kind === "rsc_operation")
        .length,
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

async function formattedInventory(
  repoRoot: string,
  inventory: TeamsEvryCapabilityInventory
) {
  const file = path.join(repoRoot, GENERATED_INVENTORY);
  const config = (await resolvePrettierConfig(file)) ?? {};
  return formatWithPrettier(`${JSON.stringify(inventory)}\n`, {
    ...config,
    filepath: file,
  });
}

export async function writeTeamsCapabilityInventory(
  repoRoot: string,
  inventory: TeamsEvryCapabilityInventory
) {
  writeFileSync(
    path.join(repoRoot, GENERATED_INVENTORY),
    await formattedInventory(repoRoot, inventory)
  );
}

export async function assertTeamsCapabilityInventoryCurrent(
  repoRoot: string,
  inventory: TeamsEvryCapabilityInventory
) {
  const file = path.join(repoRoot, GENERATED_INVENTORY);
  if (
    readFileSync(file, "utf8") !==
    (await formattedInventory(repoRoot, inventory))
  ) {
    throw new Error(
      "Teams capability inventory is stale; run pnpm evry:teams-inventory"
    );
  }
}
