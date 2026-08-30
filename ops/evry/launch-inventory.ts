import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  format as formatWithPrettier,
  resolveConfig as resolvePrettierConfig,
} from "prettier";
import ts from "typescript";

import type { Capability } from "../../src/lib/auth/seat-rules";
import { collectActionSurfaces, collectRouteSurfaces } from "./inventory";

const OUTPUT = "src/lib/evry/capabilities/launch/inventory.generated.json";
const ACTION_SOURCE = "src/app/(dashboard)/launch/actions.ts";
const PAGE_SOURCE = "src/app/(dashboard)/launch/page.tsx";
const READINESS_SOURCE = "src/lib/launch/milestones.ts";

type OperationKind = "read" | "effect";
type Contract = Readonly<{
  capabilityIdentity: string;
  operationKind: OperationKind;
  applicationCapability: Capability;
}>;

const ACTION_CONTRACTS = {
  completeMilestoneAction: {
    capabilityIdentity: "launch.milestone.complete",
    operationKind: "effect",
    applicationCapability: "launch.milestone",
  },
  recordLaunchOutcomeAction: {
    capabilityIdentity: "launch.outcome.record",
    operationKind: "effect",
    applicationCapability: "launch.schedule",
  },
  reopenMilestoneAction: {
    capabilityIdentity: "launch.milestone.reopen",
    operationKind: "effect",
    applicationCapability: "launch.milestone",
  },
  scheduleLaunchAction: {
    capabilityIdentity: "launch.schedule",
    operationKind: "effect",
    applicationCapability: "launch.schedule",
  },
  setLaunchTaskCompleteAction: {
    capabilityIdentity: "launch.task.set-completion",
    operationKind: "effect",
    applicationCapability: "launch.milestone",
  },
  updateLaunchOutcomeAction: {
    capabilityIdentity: "launch.outcome.correct",
    operationKind: "effect",
    applicationCapability: "launch.schedule",
  },
} as const satisfies Record<string, Contract>;

const RSC_CONTRACTS = {
  HeaderBreadcrumbs: "excluded:presentation_component",
  LaunchDateCard: "excluded:presentation_component",
  LaunchHistory: "excluded:presentation_component",
  LaunchJournal: "excluded:presentation_component",
  LaunchTabs: "excluded:presentation_component",
  MilestoneBoard: "excluded:presentation_component",
  OutcomeForm: "excluded:presentation_component",
  PageCanvas: "excluded:presentation_component",
  ScheduleLaunchForm: "excluded:presentation_component",
  canEditOutcome: "excluded:presentation_projection",
  canRecordOutcome: "excluded:presentation_projection",
  buildLaunchHistory: "excluded:presentation_projection",
  daysUntilTarget: "excluded:presentation_projection",
  getLaunchForChurch: "launch.read.status",
  getLaunchJournalEntries: "launch.read.journal",
  getLaunchMilestoneHistory: "launch.read.journal",
  convergeLaunchReadiness: "excluded:owner_read_repair",
  holdsSeatFor: "excluded:authorization_gate",
  isChurchLevelUser: "excluded:authorization_gate",
  launchDateEvents: "excluded:presentation_projection",
  redirect: "excluded:framework_navigation",
  verifySession: "excluded:session_boundary",
} as const;

function capabilityForRead(identity: string): Contract {
  return {
    capabilityIdentity: identity,
    operationKind: "read",
    applicationCapability: "read",
  };
}

function blockHasUseServerDirective(body: ts.Block): boolean {
  return body.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use server"
  );
}

/** Compiler-shaped discovery of every imported operation invoked by the RSC. */
function calledImports(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    PAGE_SOURCE,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const importedByLocalName = new Map<string, string>();
  const namespaceImports = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    if (statement.importClause.isTypeOnly) continue;
    if (statement.importClause.name) {
      importedByLocalName.set(statement.importClause.name.text, "default");
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        importedByLocalName.set(
          element.name.text,
          element.propertyName?.text ?? element.name.text
        );
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaceImports.add(bindings.name.text);
    }
  }

  const called = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isArrowFunction(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      blockHasUseServerDirective(node.body)
    ) {
      const name =
        "name" in node && node.name && ts.isIdentifier(node.name)
          ? node.name.text
          : ts.isVariableDeclaration(node.parent) &&
              ts.isIdentifier(node.parent.name)
            ? node.parent.name.text
            : "(anonymous)";
      throw new Error(`Unclassified Launch inline server action: ${name}`);
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const imported = importedByLocalName.get(node.expression.text);
        if (imported) called.add(imported);
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        namespaceImports.has(node.expression.expression.text)
      ) {
        called.add(node.expression.name.text);
      }
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(sourceFile).includes("import("))
      ) {
        throw new Error("Unclassified Launch dynamic RSC import");
      }
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName)
    ) {
      const imported = importedByLocalName.get(node.tagName.text);
      if (imported) called.add(imported);
    } else if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isPropertyAccessExpression(node.tagName) &&
      ts.isIdentifier(node.tagName.expression) &&
      namespaceImports.has(node.tagName.expression.text)
    ) {
      called.add(node.tagName.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...called].sort();
}

export function generateLaunchCapabilityInventory(repoRoot: string) {
  const actions = collectActionSurfaces().filter(
    ({ source }) => source === ACTION_SOURCE
  );
  const actionEntries = actions.map((surface) => {
    const contract =
      ACTION_CONTRACTS[surface.exportName as keyof typeof ACTION_CONTRACTS];
    if (!contract)
      throw new Error(`Unclassified Launch action: ${surface.identity}`);
    if (surface.applicationCapability !== contract.applicationCapability) {
      throw new Error(`Launch action capability drift: ${surface.identity}`);
    }
    return {
      kind: "action" as const,
      identity: surface.identity,
      source: surface.source,
      exportName: surface.exportName,
      ...contract,
      confirmation: "required" as const,
      classification: { state: "supported" as const },
    };
  });

  const launchRoutes = collectRouteSurfaces(repoRoot).filter(
    ({ path }) => path === "/launch"
  );
  const route = launchRoutes[0];
  if (!route) throw new Error("Launch route is missing");
  if (
    launchRoutes.length !== 1 ||
    route.sources.length !== 1 ||
    route.sources[0] !== PAGE_SOURCE
  ) {
    throw new Error(
      `Launch route has unexpected sources: ${launchRoutes.flatMap(({ sources }) => sources).join(", ")}`
    );
  }
  const routeEntry = {
    kind: "route" as const,
    identity: route.identity,
    source: PAGE_SOURCE,
    exportName: null,
    ...capabilityForRead("launch.read.status"),
    confirmation: "not_required" as const,
    classification: { state: "supported" as const },
  };

  const pageSource = readFileSync(path.join(repoRoot, PAGE_SOURCE), "utf8");
  const rscEntries = calledImports(pageSource).map((exportName) => {
    const contract = RSC_CONTRACTS[exportName as keyof typeof RSC_CONTRACTS];
    if (!contract)
      throw new Error(`Unclassified Launch RSC operation: ${exportName}`);
    const identity = `rsc:${PAGE_SOURCE} → ${exportName}`;
    if (contract.startsWith("excluded:")) {
      return {
        kind: "rsc_operation" as const,
        identity,
        source: PAGE_SOURCE,
        exportName,
        capabilityIdentity: null,
        operationKind: "excluded" as const,
        applicationCapability: null,
        confirmation: "excluded" as const,
        classification: {
          state: "excluded" as const,
          reason: contract.slice("excluded:".length),
        },
      };
    }
    return {
      kind: "rsc_operation" as const,
      identity,
      source: PAGE_SOURCE,
      exportName,
      ...capabilityForRead(contract),
      confirmation: "not_required" as const,
      classification: { state: "supported" as const },
    };
  });

  const readinessSource = readFileSync(
    path.join(repoRoot, READINESS_SOURCE),
    "utf8"
  );
  if (
    !/export\s+async\s+function\s+getLaunchReadiness\s*\(/.test(
      readinessSource
    ) ||
    !/export\s+async\s+function\s+convergeLaunchReadiness\s*\(/.test(
      readinessSource
    ) ||
    !/const\s+readiness\s*=\s*await\s+getLaunchReadiness\s*\(/.test(
      readinessSource
    )
  ) {
    throw new Error("Launch readiness read adapter is missing");
  }
  const adapterEntry = {
    kind: "evry_adapter" as const,
    identity: `adapter:${READINESS_SOURCE} → getLaunchReadiness`,
    source: READINESS_SOURCE,
    exportName: "getLaunchReadiness",
    ...capabilityForRead("launch.read.readiness"),
    confirmation: "not_required" as const,
    classification: { state: "supported" as const },
  };

  const entries = [
    ...actionEntries,
    adapterEntry,
    routeEntry,
    ...rscEntries,
  ].sort((a, b) => a.identity.localeCompare(b.identity));
  const supported = entries.filter(
    (entry) => entry.classification.state === "supported"
  );
  const capabilities = [
    ...new Set(supported.map((entry) => entry.capabilityIdentity)),
  ]
    .filter((identity): identity is string => Boolean(identity))
    .sort()
    .map((identity) => {
      const surfaces = supported.filter(
        (entry) => entry.capabilityIdentity === identity
      );
      const first = surfaces[0]!;
      return {
        identity,
        surfaceIdentities: surfaces.map(
          ({ identity: surfaceIdentity }) => surfaceIdentity
        ),
        parityCapability: "launch" as const,
        operationKind: first.operationKind as OperationKind,
        applicationCapability: first.applicationCapability as Capability,
        confirmation: first.confirmation as "required" | "not_required",
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
    generatedBy: "pnpm evry:launch-inventory" as const,
    authoritativeSources: {
      actions: "src/lib/auth/capability-map.ts" as const,
      route: PAGE_SOURCE,
      rscOperations: `called imports in ${PAGE_SOURCE}`,
      evryAdapters: READINESS_SOURCE,
    },
    capabilities,
    entries,
    summary: {
      actions: actionEntries.length,
      adapterOperations: 1,
      routes: 1,
      rscOperations: rscEntries.length,
      exclusions: rscEntries.filter(
        (entry) => entry.classification.state === "excluded"
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

async function formatted(
  inventory: ReturnType<typeof generateLaunchCapabilityInventory>,
  repoRoot: string
) {
  const config = await resolvePrettierConfig(path.join(repoRoot, OUTPUT));
  return formatWithPrettier(JSON.stringify(inventory), {
    ...config,
    parser: "json",
  });
}

export async function writeLaunchCapabilityInventory(repoRoot: string) {
  writeFileSync(
    path.join(repoRoot, OUTPUT),
    await formatted(generateLaunchCapabilityInventory(repoRoot), repoRoot)
  );
}

export async function assertLaunchCapabilityInventoryCurrent(repoRoot: string) {
  const expected = await formatted(
    generateLaunchCapabilityInventory(repoRoot),
    repoRoot
  );
  const actual = readFileSync(path.join(repoRoot, OUTPUT), "utf8");
  if (actual !== expected)
    throw new Error(
      "Launch capability inventory is stale; run pnpm evry:launch-inventory"
    );
}
