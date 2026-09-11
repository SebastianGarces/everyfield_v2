import { readFileSync, writeFileSync } from "node:fs";
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
  "platform",
  "inventory.generated.json"
);

type OperationKind = "read" | "effect";
type MutationShape = "single_update" | "bulk_update" | "single_create";
type Contract = Readonly<{
  capabilityIdentity: string;
  domain: "dashboard" | "notifications" | "feedback";
  operationKind: OperationKind;
  mutationShape: MutationShape | null;
}>;

const ACTION_CONTRACTS = {
  loadMoreNotificationsAction: {
    capabilityIdentity: "notifications.feed.list",
    domain: "notifications",
    operationKind: "read",
    mutationShape: null,
  },
  markNotificationReadAction: {
    capabilityIdentity: "notifications.feed.mark-one-read",
    domain: "notifications",
    operationKind: "effect",
    mutationShape: "single_update",
  },
  markAllNotificationsReadAction: {
    capabilityIdentity: "notifications.feed.mark-all-read",
    domain: "notifications",
    operationKind: "effect",
    mutationShape: "bulk_update",
  },
  submitFeedbackAction: {
    capabilityIdentity: "platform.feedback.submit",
    domain: "feedback",
    operationKind: "effect",
    mutationShape: "single_create",
  },
} as const satisfies Readonly<Record<string, Contract>>;

const ROUTE_CONTRACTS = {
  "/dashboard": {
    capabilityIdentity: "dashboard.summary.get",
    domain: "dashboard",
    operationKind: "read",
    mutationShape: null,
  },
  "/notifications": {
    capabilityIdentity: "notifications.feed.list",
    domain: "notifications",
    operationKind: "read",
    mutationShape: null,
  },
} as const satisfies Readonly<Record<string, Contract>>;

const NOTIFICATION_COUNT_CONTRACT = {
  capabilityIdentity: "notifications.badge.unread-count",
  domain: "notifications",
  operationKind: "read",
  mutationShape: null,
} as const satisfies Contract;

const ROUTE_EXCLUSIONS = {
  "/admin/feedback": "platform_admin_only",
} as const;

const RSC_CONTRACTS = {
  getDashboardMetrics: ROUTE_CONTRACTS["/dashboard"],
  getRecentActivity: ROUTE_CONTRACTS["/dashboard"],
  loadNotificationFeedScreen: ROUTE_CONTRACTS["/notifications"],
  loadUnreadBadgeCountSafely: NOTIFICATION_COUNT_CONTRACT,
} as const satisfies Readonly<Record<string, Contract>>;

const EXCLUDED_ACTIONS = {
  completeOnboarding: "pre_tenancy_onboarding",
  confirmLeadership: "pre_tenancy_onboarding",
  createChurchBasics: "pre_tenancy_onboarding",
  declareJourney: "pre_tenancy_onboarding",
  updateFeedbackStatusAction: "platform_admin_only",
} as const;

type Entry = Readonly<{
  kind: "action" | "route" | "rsc_read";
  identity: string;
  source: string;
  exportName: string | null;
  capabilityIdentity: string;
  domain: string;
  operationKind: OperationKind | "excluded";
  applicationCapability: Capability | null;
  confirmation: "required" | "not_required" | "excluded";
  mutationShape: MutationShape | null;
  classification:
    | Readonly<{ state: "supported" }>
    | Readonly<{
        state: "excluded";
        reason: "pre_tenancy_onboarding" | "platform_admin_only";
      }>;
}>;

const actionSourcePrefixes = [
  "src/app/(dashboard)/dashboard/",
  "src/app/(dashboard)/notifications/",
  "src/app/(dashboard)/feedback/",
  "src/app/(dashboard)/admin/feedback/",
] as const;

function isPlatformActionSource(source: string) {
  return actionSourcePrefixes.some((prefix) => source.startsWith(prefix));
}

function supportedEntry(
  base: Pick<Entry, "kind" | "identity" | "source" | "exportName">,
  contract: Contract,
  applicationCapability: Capability
): Entry {
  return {
    ...base,
    ...contract,
    applicationCapability,
    confirmation:
      contract.operationKind === "effect" ? "required" : "not_required",
    classification: { state: "supported" },
  };
}

function actionEntries(): Entry[] {
  return collectActionSurfaces()
    .filter(({ source }) => isPlatformActionSource(source))
    .map((surface): Entry => {
      const contract =
        ACTION_CONTRACTS[surface.exportName as keyof typeof ACTION_CONTRACTS];
      if (contract && surface.applicationCapability) {
        return supportedEntry(
          {
            kind: "action",
            identity: surface.identity,
            source: surface.source,
            exportName: surface.exportName,
          },
          contract,
          surface.applicationCapability
        );
      }
      const reason =
        EXCLUDED_ACTIONS[surface.exportName as keyof typeof EXCLUDED_ACTIONS];
      if (!reason) {
        throw new Error(`Unclassified platform action: ${surface.identity}`);
      }
      return {
        kind: "action",
        identity: surface.identity,
        source: surface.source,
        exportName: surface.exportName,
        capabilityIdentity: `boundary.${reason.replaceAll("_", "-")}`,
        domain: surface.source.includes("admin/feedback")
          ? "feedback"
          : "dashboard",
        operationKind: "excluded",
        applicationCapability: null,
        confirmation: "excluded",
        mutationShape: null,
        classification: { state: "excluded", reason },
      };
    });
}

const routePrefixes = [
  "/dashboard",
  "/notifications",
  "/feedback",
  "/admin/feedback",
] as const;

function isPlatformRoute(routePath: string) {
  return routePrefixes.some(
    (prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`)
  );
}

function platformRouteSurfaces(repoRoot: string) {
  return collectRouteSurfaces(repoRoot).filter(({ path: routePath }) =>
    isPlatformRoute(routePath)
  );
}

function routeEntries(repoRoot: string): Entry[] {
  return platformRouteSurfaces(repoRoot).map((surface) => {
    const base = {
      kind: "route" as const,
      identity: surface.identity,
      source: surface.sources.join(","),
      exportName: null,
    };
    const contract =
      ROUTE_CONTRACTS[surface.path as keyof typeof ROUTE_CONTRACTS];
    if (contract) return supportedEntry(base, contract, "read");
    const reason =
      ROUTE_EXCLUSIONS[surface.path as keyof typeof ROUTE_EXCLUSIONS];
    if (!reason) {
      throw new Error(`Unclassified platform route: ${surface.identity}`);
    }
    return {
      ...base,
      capabilityIdentity: `boundary.${reason.replaceAll("_", "-")}`,
      domain: "feedback",
      operationKind: "excluded",
      applicationCapability: null,
      confirmation: "excluded",
      mutationShape: null,
      classification: { state: "excluded", reason },
    };
  });
}

const RSC_OWNER_DIRECTORIES = [
  "src/lib/dashboard/",
  "src/lib/notifications/",
] as const;

const RSC_OWNER_FILES = ["src/app/(dashboard)/notification-badge.ts"] as const;

const ADDITIONAL_RSC_SOURCES = [
  "src/app/(dashboard)/layout.tsx",
  "src/app/(dashboard)/dashboard/plant-dashboard.tsx",
] as const;

function isPlatformRscOwner(owner: string) {
  return (
    RSC_OWNER_FILES.includes(owner as (typeof RSC_OWNER_FILES)[number]) ||
    RSC_OWNER_DIRECTORIES.some((directory) => owner.startsWith(directory))
  );
}

function supportedRscSources(repoRoot: string) {
  return [
    ...platformRouteSurfaces(repoRoot).flatMap((surface) =>
      surface.path in ROUTE_CONTRACTS ? surface.sources : []
    ),
    ...ADDITIONAL_RSC_SOURCES,
  ];
}

export type DiscoveredPlatformRscCall = Readonly<{
  source: string;
  owner: string;
  exportName: string;
}>;

function toPosix(value: string) {
  return value.split(path.sep).join("/");
}

function compilerOptions(repoRoot: string): ts.CompilerOptions {
  const configPath = path.join(repoRoot, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      `Platform inventory could not read tsconfig.json: ${ts.flattenDiagnosticMessageText(config.error.messageText, "\n")}`
    );
  }
  return ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot).options;
}

function resolvedSymbol(checker: ts.TypeChecker, node: ts.Node) {
  let symbol = checker.getSymbolAtLocation(node);
  const seen = new Set<ts.Symbol>();
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    if (seen.has(symbol)) return undefined;
    seen.add(symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol;
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

/** Compiler-backed discovery follows aliases and re-exports to owning code. */
export function discoverPlatformRscCalls(
  repoRoot: string,
  sources: readonly string[] = supportedRscSources(repoRoot)
): DiscoveredPlatformRscCall[] {
  const absoluteSources = sources.map((source) => path.join(repoRoot, source));
  const program = ts.createProgram({
    rootNames: absoluteSources,
    options: compilerOptions(repoRoot),
  });
  const checker = program.getTypeChecker();
  const discovered = new Map<string, DiscoveredPlatformRscCall>();
  for (const [index, absoluteSource] of absoluteSources.entries()) {
    const source = sources[index];
    const sourceFile = program.getSourceFile(absoluteSource);
    if (!source || !sourceFile) {
      throw new Error(
        `Platform inventory could not load RSC source: ${source}`
      );
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && callIsAwaited(node)) {
        const target = ts.isIdentifier(node.expression)
          ? node.expression
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name
            : null;
        const symbol = target ? resolvedSymbol(checker, target) : undefined;
        const declaration =
          symbol?.valueDeclaration ?? symbol?.declarations?.[0];
        if (symbol && declaration) {
          const owner = toPosix(
            path.relative(repoRoot, declaration.getSourceFile().fileName)
          );
          if (isPlatformRscOwner(owner)) {
            const declarationName = (declaration as ts.NamedDeclaration).name;
            const exportName =
              declarationName && ts.isIdentifier(declarationName)
                ? declarationName.text
                : symbol.name;
            const call = { source, owner, exportName };
            discovered.set(`${source}\0${owner}\0${exportName}`, call);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return [...discovered.values()].toSorted((left, right) =>
    `${left.source}\0${left.owner}\0${left.exportName}`.localeCompare(
      `${right.source}\0${right.owner}\0${right.exportName}`
    )
  );
}

export function classifyPlatformRscCall(
  call: DiscoveredPlatformRscCall
): Entry {
  const contract = RSC_CONTRACTS[call.exportName as keyof typeof RSC_CONTRACTS];
  const identity = `rsc-read:${call.source} → ${call.owner}#${call.exportName}`;
  if (contract) {
    return supportedEntry(
      {
        kind: "rsc_read",
        identity,
        source: call.source,
        exportName: call.exportName,
      },
      contract,
      "read"
    );
  }
  throw new Error(`Unclassified platform RSC operation: ${identity}`);
}

function rscEntries(repoRoot: string): Entry[] {
  return discoverPlatformRscCalls(repoRoot).map(classifyPlatformRscCall);
}

export function buildPlatformEvryInventory(repoRoot: string) {
  const entries = [
    ...actionEntries(),
    ...routeEntries(repoRoot),
    ...rscEntries(repoRoot),
  ].sort((left, right) => left.identity.localeCompare(right.identity));
  const supported = entries.filter(
    (entry) => entry.classification.state === "supported"
  );
  const grouped = new Map<string, typeof supported>();
  for (const entry of supported) {
    grouped.set(entry.capabilityIdentity, [
      ...(grouped.get(entry.capabilityIdentity) ?? []),
      entry,
    ]);
  }
  const capabilities = [...grouped].map(([identity, surfaces]) => {
    const [first, ...rest] = surfaces;
    if (!first) throw new Error(`Empty platform capability: ${identity}`);
    if (
      surfaces.some(
        (surface) =>
          surface.operationKind !== first.operationKind ||
          surface.applicationCapability !== first.applicationCapability ||
          surface.domain !== first.domain ||
          surface.mutationShape !== first.mutationShape
      )
    ) {
      throw new Error(`Inconsistent platform capability: ${identity}`);
    }
    return {
      identity,
      surfaceIdentities: [
        first.identity,
        ...rest.map(({ identity }) => identity),
      ],
      parityCapability:
        first.domain === "feedback" ? "product-feedback" : first.domain,
      domain: first.domain,
      operationKind: first.operationKind,
      applicationCapability: first.applicationCapability,
      confirmation:
        first.operationKind === "effect" ? "required" : "not_required",
      mutationShape: first.mutationShape,
      fixtureClasses: [
        "selection",
        "arguments",
        "confirmation",
        "execution",
        "idempotency",
        "failure",
      ],
    };
  });
  return {
    schemaVersion: 1,
    generatedBy: "pnpm evry:platform-inventory",
    authoritativeSources: {
      actions: "src/lib/auth/capability-map.ts",
      routes:
        "authenticated layout, /dashboard, /notifications, /feedback, and admin feedback routes",
      rscReads:
        "owning dashboard and notification service calls, including the authenticated shell badge",
    },
    capabilities,
    entries,
    summary: {
      actions: entries.filter(({ kind }) => kind === "action").length,
      routes: entries.filter(({ kind }) => kind === "route").length,
      rscReads: entries.filter(({ kind }) => kind === "rsc_read").length,
      readCapabilities: capabilities.filter(
        ({ operationKind }) => operationKind === "read"
      ).length,
      effectCapabilities: capabilities.filter(
        ({ operationKind }) => operationKind === "effect"
      ).length,
      excluded: entries.filter(
        ({ classification }) => classification.state === "excluded"
      ).length,
      unclassified: 0,
    },
  } as const;
}

export async function generatePlatformEvryInventory(input: {
  repoRoot: string;
  check: boolean;
}) {
  const destination = path.join(input.repoRoot, GENERATED_INVENTORY);
  const config = await resolvePrettierConfig(destination);
  const rendered = await formatWithPrettier(
    `${JSON.stringify(buildPlatformEvryInventory(input.repoRoot), null, 2)}\n`,
    { ...config, filepath: destination }
  );
  if (input.check) {
    if (readFileSync(destination, "utf8") !== rendered) {
      throw new Error("Platform Evry inventory is stale");
    }
    return;
  }
  writeFileSync(destination, rendered);
}
