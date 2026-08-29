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
  "communication",
  "inventory.generated.json"
);

const COMMUNICATION_ACTION_SOURCE =
  "src/app/(dashboard)/communication/actions.ts";
const DASHBOARD_ROOT = path.join("src", "app", "(dashboard)");

export type CommunicationEvryOperationKind = "read" | "effect";
export type CommunicationEvryMutationShape =
  | "single_create"
  | "single_update"
  | "single_delete"
  | "compound_write"
  | "external_send"
  | "external_resend";

export type CommunicationEvrySurface = Readonly<{
  kind: "action" | "route" | "rsc_read" | "external" | "product_gap";
  identity: string;
  source: string;
  exportName: string | null;
  capabilityIdentity: string;
  domain: string;
  operationKind: CommunicationEvryOperationKind | "excluded";
  applicationCapability: Capability | null;
  confirmation: "not_required" | "required" | "excluded";
  mutationShape: CommunicationEvryMutationShape | null;
  classification:
    | Readonly<{ state: "supported" }>
    | Readonly<{
        state: "excluded";
        reason: "public_or_sessionless" | "owning_product_gap";
      }>;
}>;

export type CommunicationEvryCapabilityInventory = Readonly<{
  schemaVersion: 1;
  generatedBy: "pnpm evry:communication-inventory";
  authoritativeSources: Readonly<{
    actions: "src/lib/auth/capability-map.ts";
    routes: "src/app/(dashboard)/communication/**/page.tsx";
    rscReads: "async @/lib/communication/* imports in dashboard server components";
    external: "Communication provider and RSVP route handlers";
  }>;
  capabilities: readonly Readonly<{
    identity: string;
    surfaceIdentities: readonly string[];
    parityCapability: "communication";
    domain: string;
    operationKind: CommunicationEvryOperationKind;
    applicationCapability: Capability;
    confirmation: "not_required" | "required";
    mutationShape: CommunicationEvryMutationShape | null;
  }>[];
  entries: readonly CommunicationEvrySurface[];
  summary: Readonly<{
    actions: number;
    routes: number;
    rscReads: number;
    externalExclusions: number;
    productGaps: number;
    readCapabilities: number;
    effectCapabilities: number;
    unclassified: 0;
  }>;
}>;

type SupportedContract = Readonly<{
  capabilityIdentity: string;
  domain: string;
  operationKind: CommunicationEvryOperationKind;
  mutationShape: CommunicationEvryMutationShape | null;
}>;

const ACTION_CONTRACTS = {
  createTemplateAction: {
    capabilityIdentity: "communication.templates.create",
    domain: "templates",
    operationKind: "effect",
    mutationShape: "single_create",
  },
  deleteTemplateAction: {
    capabilityIdentity: "communication.templates.delete",
    domain: "templates",
    operationKind: "effect",
    mutationShape: "single_delete",
  },
  forkTemplateAction: {
    capabilityIdentity: "communication.templates.fork",
    domain: "templates",
    operationKind: "effect",
    mutationShape: "compound_write",
  },
  getTemplatesAction: {
    capabilityIdentity: "communication.templates.list",
    domain: "templates",
    operationKind: "read",
    mutationShape: null,
  },
  resendToNonOpenersAction: {
    capabilityIdentity: "communication.resends.send-to-non-openers",
    domain: "resends",
    operationKind: "effect",
    mutationShape: "external_resend",
  },
  resolveGroupAction: {
    capabilityIdentity: "communication.recipients.resolve-group",
    domain: "recipients",
    operationKind: "read",
    mutationShape: null,
  },
  searchPeopleAction: {
    capabilityIdentity: "communication.recipients.search-people",
    domain: "recipients",
    operationKind: "read",
    mutationShape: null,
  },
  sendMessageAction: {
    capabilityIdentity: "communication.messages.send",
    domain: "messages",
    operationKind: "effect",
    mutationShape: "external_send",
  },
  updateTemplateAction: {
    capabilityIdentity: "communication.templates.update",
    domain: "templates",
    operationKind: "effect",
    mutationShape: "single_update",
  },
} as const satisfies Readonly<Record<string, SupportedContract>>;

const ROUTE_CONTRACTS = {
  "/communication": {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  "/communication/[id]": {
    capabilityIdentity: "communication.delivery.get-message",
    domain: "delivery",
    operationKind: "read",
    mutationShape: null,
  },
  "/communication/compose": {
    capabilityIdentity: "communication.compose.get-context",
    domain: "compose",
    operationKind: "read",
    mutationShape: null,
  },
  "/communication/history": {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  "/communication/templates": {
    capabilityIdentity: "communication.templates.list",
    domain: "templates",
    operationKind: "read",
    mutationShape: null,
  },
  "/communication/templates/[id]/edit": {
    capabilityIdentity: "communication.templates.get",
    domain: "templates",
    operationKind: "read",
    mutationShape: null,
  },
} as const satisfies Readonly<Record<string, SupportedContract>>;

const RSC_READ_CONTRACTS = {
  countCommunications: {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  countSentSince: {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  getChurchDeliveryTotals: {
    capabilityIdentity: "communication.delivery.get-church-totals",
    domain: "delivery",
    operationKind: "read",
    mutationShape: null,
  },
  getCommunication: {
    capabilityIdentity: "communication.delivery.get-message",
    domain: "delivery",
    operationKind: "read",
    mutationShape: null,
  },
  getCommunicationRecipients: {
    capabilityIdentity: "communication.delivery.get-message-recipients",
    domain: "delivery",
    operationKind: "read",
    mutationShape: null,
  },
  getCommunications: {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  getMeetingCommunications: {
    capabilityIdentity: "communication.history.get-meeting",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  getMeetingTrackingByPerson: {
    capabilityIdentity: "communication.delivery.get-meeting-tracking",
    domain: "delivery",
    operationKind: "read",
    mutationShape: null,
  },
  getNonOpenerSummary: {
    capabilityIdentity: "communication.resends.get-eligible-non-openers",
    domain: "resends",
    operationKind: "read",
    mutationShape: null,
  },
  getPersonCommunications: {
    capabilityIdentity: "communication.history.get-person",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
  getTemplate: {
    capabilityIdentity: "communication.templates.get",
    domain: "templates",
    operationKind: "read",
    mutationShape: null,
  },
  getTemplates: {
    capabilityIdentity: "communication.templates.list",
    domain: "templates",
    operationKind: "read",
    mutationShape: null,
  },
  listRecipientTeams: {
    capabilityIdentity: "communication.recipients.list-teams",
    domain: "recipients",
    operationKind: "read",
    mutationShape: null,
  },
  resolveSubjects: {
    capabilityIdentity: "communication.history.list",
    domain: "history",
    operationKind: "read",
    mutationShape: null,
  },
} as const satisfies Readonly<Record<string, SupportedContract>>;

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

function supportedSurface(
  input: Pick<
    CommunicationEvrySurface,
    "kind" | "identity" | "source" | "exportName"
  >,
  contract: SupportedContract,
  applicationCapability: Capability
): CommunicationEvrySurface {
  return {
    ...input,
    ...contract,
    applicationCapability,
    confirmation:
      contract.operationKind === "effect" ? "required" : "not_required",
    classification: { state: "supported" },
  };
}

function actionSurfaces(): CommunicationEvrySurface[] {
  const surfaces = collectActionSurfaces().filter(
    (surface) => surface.source === COMMUNICATION_ACTION_SOURCE
  );
  return surfaces.map((surface) => {
    const contract =
      ACTION_CONTRACTS[surface.exportName as keyof typeof ACTION_CONTRACTS];
    if (!contract || surface.applicationCapability === null) {
      throw new Error(
        `Communication inventory has no closed action contract for ${surface.identity}`
      );
    }
    return supportedSurface(
      {
        kind: "action",
        identity: surface.identity,
        source: surface.source,
        exportName: surface.exportName,
      },
      contract,
      surface.applicationCapability
    );
  });
}

function routeSurfaces(repoRoot: string): CommunicationEvrySurface[] {
  return collectRouteSurfaces(repoRoot)
    .filter(
      (surface) =>
        surface.path === "/communication" ||
        surface.path.startsWith("/communication/")
    )
    .map((surface) => {
      const contract =
        ROUTE_CONTRACTS[surface.path as keyof typeof ROUTE_CONTRACTS];
      if (!contract) {
        throw new Error(
          `Communication inventory has no closed route contract for ${surface.identity}`
        );
      }
      return supportedSurface(
        {
          kind: "route",
          identity: surface.identity,
          source: surface.sources.join(","),
          exportName: null,
        },
        contract,
        "read"
      );
    });
}

function exportedAsyncNames(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)\b/g)].map(
      (match) => match[1] as string
    )
  );
}

function rscReadSurfaces(repoRoot: string): CommunicationEvrySurface[] {
  const candidates = walk(path.join(repoRoot, DASHBOARD_ROOT)).filter(
    (file) =>
      /\.[jt]sx?$/.test(file) &&
      !/\.(?:test|proof)\.[jt]sx?$/.test(file) &&
      !file.endsWith("/actions.ts")
  );
  const asyncByModule = new Map<string, Set<string>>();
  const entries: CommunicationEvrySurface[] = [];

  for (const file of candidates) {
    const source = readFileSync(file, "utf8");
    if (/^\s*["']use client["'];/m.test(source)) continue;
    const caller = toPosix(path.relative(repoRoot, file));
    for (const match of source.matchAll(
      /import\s+(?!type\s+)\{([^}]*)\}\s+from\s+["'](@\/lib\/communication\/[A-Za-z0-9_.-]+)["'];/g
    )) {
      const imported = match[1] as string;
      const modulePath = match[2] as string;
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
        const contract =
          RSC_READ_CONTRACTS[exportName as keyof typeof RSC_READ_CONTRACTS];
        if (!contract) {
          throw new Error(
            `Communication inventory has no closed RSC read contract for ${caller} → ${modulePath}#${exportName}`
          );
        }
        entries.push(
          supportedSurface(
            {
              kind: "rsc_read",
              identity: `rsc-read:${caller} → ${modulePath}#${exportName}`,
              source: caller,
              exportName,
            },
            contract,
            "read"
          )
        );
      }
    }
  }
  return entries;
}

const EXCLUDED_SURFACES: readonly CommunicationEvrySurface[] = [
  {
    kind: "external",
    identity: "handler:POST:/api/webhooks/resend",
    source: "src/app/api/webhooks/resend/route.ts",
    exportName: "POST",
    capabilityIdentity: "communication.delivery.ingest-provider-event",
    domain: "delivery",
    operationKind: "excluded",
    applicationCapability: null,
    confirmation: "excluded",
    mutationShape: null,
    classification: { state: "excluded", reason: "public_or_sessionless" },
  },
  {
    kind: "external",
    identity: "handler:GET|POST:/api/rsvp/[token]",
    source: "src/app/api/rsvp/[token]/route.ts",
    exportName: null,
    capabilityIdentity: "communication.rsvp.respond-by-token",
    domain: "rsvp",
    operationKind: "excluded",
    applicationCapability: null,
    confirmation: "excluded",
    mutationShape: null,
    classification: { state: "excluded", reason: "public_or_sessionless" },
  },
  {
    kind: "product_gap",
    identity: "product-gap:communication.drafts.persist",
    source: "src/db/schema/communication.ts",
    exportName: null,
    capabilityIdentity: "communication.drafts.persist",
    domain: "drafts",
    operationKind: "excluded",
    applicationCapability: null,
    confirmation: "excluded",
    mutationShape: null,
    classification: { state: "excluded", reason: "owning_product_gap" },
  },
];

function assertBijection(entries: readonly CommunicationEvrySurface[]): void {
  const identities = entries.map(({ identity }) => identity);
  const duplicates = identities.filter(
    (identity, index) => identities.indexOf(identity) !== index
  );
  if (duplicates.length > 0) {
    throw new Error(
      `Communication inventory repeats authoritative surfaces:\n${[
        ...new Set(duplicates),
      ].join("\n")}`
    );
  }
  const actions = entries.filter(({ kind }) => kind === "action");
  if (actions.length !== Object.keys(ACTION_CONTRACTS).length) {
    throw new Error(
      `Communication inventory expected ${Object.keys(ACTION_CONTRACTS).length} guarded action exports, found ${actions.length}`
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
      "Communication inventory contains an unclassified supported entry"
    );
  }
}

export function generateCommunicationCapabilityInventory(
  repoRoot: string
): CommunicationEvryCapabilityInventory {
  const entries = [
    ...actionSurfaces(),
    ...routeSurfaces(repoRoot),
    ...rscReadSurfaces(repoRoot),
    ...EXCLUDED_SURFACES,
  ].toSorted((left, right) => compareStrings(left.identity, right.identity));
  assertBijection(entries);

  const byCapability = new Map<
    string,
    CommunicationEvryCapabilityInventory["capabilities"][number]
  >();
  for (const entry of entries) {
    if (entry.classification.state !== "supported") continue;
    if (
      entry.operationKind === "excluded" ||
      entry.applicationCapability === null ||
      entry.confirmation === "excluded"
    ) {
      throw new Error(
        `Communication inventory left ${entry.identity} unclassified`
      );
    }
    const capability = {
      identity: entry.capabilityIdentity,
      surfaceIdentities: [entry.identity],
      parityCapability: "communication" as const,
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
          `Communication capability ${entry.capabilityIdentity} has conflicting surfaces`
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
    }))
    .toSorted((left, right) => compareStrings(left.identity, right.identity));
  const count = (kind: CommunicationEvrySurface["kind"]) =>
    entries.filter((entry) => entry.kind === kind).length;

  return {
    schemaVersion: 1,
    generatedBy: "pnpm evry:communication-inventory",
    authoritativeSources: {
      actions: "src/lib/auth/capability-map.ts",
      routes: "src/app/(dashboard)/communication/**/page.tsx",
      rscReads:
        "async @/lib/communication/* imports in dashboard server components",
      external: "Communication provider and RSVP route handlers",
    },
    capabilities,
    entries,
    summary: {
      actions: count("action"),
      routes: count("route"),
      rscReads: count("rsc_read"),
      externalExclusions: count("external"),
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

export function generatedCommunicationInventoryPath(repoRoot: string): string {
  return path.join(repoRoot, GENERATED_INVENTORY);
}

export async function serializeCommunicationCapabilityInventory(
  inventory: CommunicationEvryCapabilityInventory,
  repoRoot: string
): Promise<string> {
  const outputPath = generatedCommunicationInventoryPath(repoRoot);
  const prettierConfig = await resolvePrettierConfig(outputPath);
  return formatWithPrettier(JSON.stringify(inventory), {
    ...prettierConfig,
    filepath: outputPath,
    parser: "json",
  });
}

export async function writeCommunicationCapabilityInventory(
  repoRoot: string,
  inventory: CommunicationEvryCapabilityInventory
): Promise<void> {
  writeFileSync(
    generatedCommunicationInventoryPath(repoRoot),
    await serializeCommunicationCapabilityInventory(inventory, repoRoot),
    "utf8"
  );
}

export async function assertCommunicationCapabilityInventoryCurrent(
  repoRoot: string,
  inventory: CommunicationEvryCapabilityInventory
): Promise<void> {
  const actual = readFileSync(
    generatedCommunicationInventoryPath(repoRoot),
    "utf8"
  );
  const expected = await serializeCommunicationCapabilityInventory(
    inventory,
    repoRoot
  );
  if (actual !== expected) {
    throw new Error(
      "Communication capability inventory is stale; run `pnpm evry:communication-inventory`"
    );
  }
}
