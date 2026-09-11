import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  format as formatWithPrettier,
  resolveConfig as resolvePrettierConfig,
} from "prettier";

import type { Capability } from "../../src/lib/auth/seat-rules";
import { collectActionSurfaces, collectRouteSurfaces } from "./inventory";
import {
  discoverPlantIntelligenceActionIdentities,
  discoverPlantIntelligenceRscOperations,
  plantIntelligenceRscOperationIdentity as rsc,
} from "./plant-intelligence-source-discovery";

const OUTPUT =
  "src/lib/evry/capabilities/plant-intelligence/inventory.generated.json";
const PAGE = "src/app/(dashboard)/phase/page.tsx";

type OperationKind = "read" | "effect";
type Contract = Readonly<{
  capabilityIdentity: string;
  domain: string;
  operationKind: OperationKind;
  applicationCapability: Capability;
}>;

const ACTION_CONTRACTS = {
  transitionPhaseAction: {
    capabilityIdentity: "plant-intelligence.declarations.transition",
    domain: "declarations",
    operationKind: "effect",
    applicationCapability: "phase.declare",
  },
  saveCheckinAction: {
    capabilityIdentity: "plant-intelligence.checkins.save",
    domain: "signals",
    operationKind: "effect",
    applicationCapability: "phase.signal",
  },
  submitInsightFeedbackAction: {
    capabilityIdentity: "plant-intelligence.feedback.submit",
    domain: "feedback",
    operationKind: "effect",
    applicationCapability: "self.write",
  },
  setManualSignalAction: {
    capabilityIdentity: "plant-intelligence.attestations.set",
    domain: "attestations",
    operationKind: "effect",
    applicationCapability: "phase.signal",
  },
} as const satisfies Record<string, Contract>;

const READ = {
  assessment: {
    capabilityIdentity: "plant-intelligence.assessments.read",
    domain: "assessments",
    operationKind: "read",
    applicationCapability: "phase.declare",
  },
  signals: {
    capabilityIdentity: "plant-intelligence.signals.read",
    domain: "signals",
    operationKind: "read",
    applicationCapability: "phase.declare",
  },
  feedback: {
    capabilityIdentity: "plant-intelligence.feedback.read",
    domain: "feedback",
    operationKind: "read",
    applicationCapability: "phase.declare",
  },
  attestations: {
    capabilityIdentity: "plant-intelligence.attestations.read",
    domain: "attestations",
    operationKind: "read",
    applicationCapability: "phase.declare",
  },
  declarations: {
    capabilityIdentity: "plant-intelligence.declarations.read",
    domain: "declarations",
    operationKind: "read",
    applicationCapability: "phase.declare",
  },
  checkins: {
    capabilityIdentity: "plant-intelligence.checkins.read",
    domain: "signals",
    operationKind: "read",
    applicationCapability: "phase.declare",
  },
} as const satisfies Record<string, Contract>;

const RSC_CONTRACTS = new Map<string, Contract | string>([
  [rsc(PAGE, "verifySession"), "authentication_boundary"],
  [rsc(PAGE, "isPlantOwner"), "authorization_projection"],
  [rsc(PAGE, "redirect"), "framework_navigation"],
  [rsc(PAGE, "db.select"), "query_builder"],
  [rsc(PAGE, "and"), "query_builder"],
  [rsc(PAGE, "eq"), "query_builder"],
  [rsc(PAGE, "inArray"), "query_builder"],
  [rsc(PAGE, "db.from(churches)"), READ.declarations],
  [rsc(PAGE, "db.from(insightFeedback)"), READ.feedback],
  [rsc(PAGE, "getLatestAssessment"), READ.assessment],
  [rsc(PAGE, "getPhaseReadiness"), READ.signals],
  [rsc(PAGE, "listManualSignals"), READ.attestations],
  [rsc(PAGE, "listRecentCheckins"), READ.checkins],
  [rsc(PAGE, "getPlantTrends"), READ.signals],
  [rsc(PAGE, "getMilestoneTimeline"), READ.signals],
  [
    rsc(PAGE, "markAssessmentSeenByPlanter"),
    {
      capabilityIdentity: "plant-intelligence.assessments.acknowledge",
      domain: "assessments",
      operationKind: "effect",
      applicationCapability: "phase.declare",
    },
  ],
  [
    rsc("src/components/phase-engine/insight-card.tsx", "getCurrentSession"),
    "authentication_boundary",
  ],
  [
    rsc(
      "src/components/phase-engine/insight-card.tsx",
      "getPublishedArticleRefs"
    ),
    READ.assessment,
  ],
]);

type Entry = Readonly<{
  kind: "action" | "route" | "rsc_operation";
  identity: string;
  source: string;
  exportName: string | null;
  capabilityIdentity: string | null;
  domain: string;
  operationKind: OperationKind | "excluded";
  applicationCapability: Capability | null;
  confirmation: "required" | "not_required" | "excluded";
  classification:
    | Readonly<{ state: "supported" }>
    | Readonly<{ state: "excluded"; reason: string }>;
}>;

function supported(
  base: Pick<Entry, "kind" | "identity" | "source" | "exportName">,
  contract: Contract
): Entry {
  return {
    ...base,
    ...contract,
    confirmation:
      contract.operationKind === "effect" ? "required" : "not_required",
    classification: { state: "supported" },
  };
}

function actionEntries(repoRoot: string): Entry[] {
  const guarded = collectActionSurfaces().filter(({ source }) =>
    source.startsWith("src/app/(dashboard)/phase/")
  );
  const discovered = discoverPlantIntelligenceActionIdentities(repoRoot);
  const guardedIds = guarded.map(({ identity }) => identity).toSorted();
  if (JSON.stringify(discovered) !== JSON.stringify(guardedIds))
    throw new Error(
      `Plant Intelligence action authority drift: discovered=[${discovered.join(", ")}], guarded=[${guardedIds.join(", ")}]`
    );
  return guarded.map((surface) => {
    const contract =
      ACTION_CONTRACTS[surface.exportName as keyof typeof ACTION_CONTRACTS];
    if (
      !contract ||
      surface.applicationCapability !== contract.applicationCapability
    )
      throw new Error(
        `Unclassified Plant Intelligence action: ${surface.identity}`
      );
    return supported(
      {
        kind: "action",
        identity: surface.identity,
        source: surface.source,
        exportName: surface.exportName,
      },
      contract
    );
  });
}

function routeEntries(repoRoot: string): Entry[] {
  const routes = collectRouteSurfaces(repoRoot).filter(
    ({ path: routePath }) => routePath === "/phase"
  );
  if (routes.length !== 1 || routes[0]?.sources.length !== 1)
    throw new Error("Plant Intelligence route source drifted");
  const route = routes[0]!;
  return [
    supported(
      {
        kind: "route",
        identity: route.identity,
        source: route.sources[0]!,
        exportName: null,
      },
      READ.assessment
    ),
  ];
}

function rscEntries(repoRoot: string): Entry[] {
  return discoverPlantIntelligenceRscOperations(repoRoot).map((identity) => {
    const contract = RSC_CONTRACTS.get(identity);
    if (!contract)
      throw new Error(
        `Unclassified Plant Intelligence RSC operation: ${identity}`
      );
    const source =
      identity.slice("rsc-operation:".length).split(" → ")[0] ?? "";
    const exportName = identity.split(" → ")[1] ?? null;
    if (typeof contract === "string")
      return {
        kind: "rsc_operation" as const,
        identity,
        source,
        exportName,
        capabilityIdentity: null,
        domain: "boundary",
        operationKind: "excluded" as const,
        applicationCapability: null,
        confirmation: "excluded" as const,
        classification: { state: "excluded" as const, reason: contract },
      };
    return supported(
      { kind: "rsc_operation", identity, source, exportName },
      contract
    );
  });
}

export function generatePlantIntelligenceCapabilityInventory(repoRoot: string) {
  const entries = [
    ...actionEntries(repoRoot),
    ...routeEntries(repoRoot),
    ...rscEntries(repoRoot),
  ].toSorted((left, right) => left.identity.localeCompare(right.identity));
  if (new Set(entries.map(({ identity }) => identity)).size !== entries.length)
    throw new Error("Plant Intelligence inventory repeats a source surface");
  const supportedEntries = entries.filter(
    (entry) => entry.classification.state === "supported"
  );
  const grouped = new Map<string, Entry[]>();
  for (const entry of supportedEntries) {
    if (!entry.capabilityIdentity)
      throw new Error("Supported entry is unbound");
    const rows = grouped.get(entry.capabilityIdentity) ?? [];
    rows.push(entry);
    grouped.set(entry.capabilityIdentity, rows);
  }
  const capabilities = [...grouped.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([identity, surfaces]) => {
      const first = surfaces[0]!;
      if (
        first.operationKind === "excluded" ||
        first.applicationCapability === null ||
        surfaces.some(
          (surface) =>
            surface.operationKind !== first.operationKind ||
            surface.applicationCapability !== first.applicationCapability
        )
      )
        throw new Error(`Plant Intelligence capability conflict: ${identity}`);
      return {
        identity,
        surfaceIdentities: surfaces.map(({ identity: surface }) => surface),
        parityCapability: "plant-intelligence" as const,
        domain: first.domain,
        operationKind: first.operationKind,
        applicationCapability: first.applicationCapability,
        confirmation: first.confirmation,
        fixtureClasses: [
          "selection",
          "arguments",
          "confirmation",
          "execution",
          "idempotency",
          "failure",
        ] as const,
      };
    });
  return {
    schemaVersion: 1 as const,
    generatedBy: "pnpm evry:plant-intelligence-inventory" as const,
    authoritativeSources: {
      actions: "src/lib/auth/capability-map.ts" as const,
      route: PAGE,
      rscOperations:
        "AST-discovered awaited imports and concrete tables in the /phase RSC graph" as const,
    },
    capabilities,
    entries,
    summary: {
      actions: entries.filter(({ kind }) => kind === "action").length,
      routes: entries.filter(({ kind }) => kind === "route").length,
      rscOperations: entries.filter(({ kind }) => kind === "rsc_operation")
        .length,
      exclusions: entries.filter(
        ({ classification }) => classification.state === "excluded"
      ).length,
      readCapabilities: capabilities.filter(
        ({ operationKind }) => operationKind === "read"
      ).length,
      effectCapabilities: capabilities.filter(
        ({ operationKind }) => operationKind === "effect"
      ).length,
      unclassified: 0 as const,
    },
  };
}

async function formatted(repoRoot: string) {
  const file = path.join(repoRoot, OUTPUT);
  return formatWithPrettier(
    JSON.stringify(generatePlantIntelligenceCapabilityInventory(repoRoot)),
    {
      ...(await resolvePrettierConfig(file)),
      filepath: file,
      parser: "json",
    }
  );
}

export async function writePlantIntelligenceCapabilityInventory(
  repoRoot: string
) {
  writeFileSync(path.join(repoRoot, OUTPUT), await formatted(repoRoot));
}

export async function assertPlantIntelligenceCapabilityInventoryCurrent(
  repoRoot: string
) {
  if (
    readFileSync(path.join(repoRoot, OUTPUT), "utf8") !==
    (await formatted(repoRoot))
  )
    throw new Error(
      "Plant Intelligence inventory is stale; run pnpm evry:plant-intelligence-inventory"
    );
}
