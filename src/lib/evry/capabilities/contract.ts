import type { Capability } from "@/lib/auth/seat-rules";

export const EVRY_EXCLUSION_REASONS = [
  "settings",
  "authentication",
  "public_or_sessionless",
  "coaching",
  "oversight",
  "pre_tenancy_onboarding",
] as const;

export const EVRY_UNREACHABLE_REASONS = ["platform_admin_only"] as const;

export type EvryExclusionReason = (typeof EVRY_EXCLUSION_REASONS)[number];
export type EvryUnreachableReason = (typeof EVRY_UNREACHABLE_REASONS)[number];

export type EvryParityClassification =
  | Readonly<{ state: "supported" }>
  | Readonly<{ state: "excluded"; reason: EvryExclusionReason }>
  | Readonly<{ state: "unreachable"; reason: EvryUnreachableReason }>;

export type EvryRouteSelector = Readonly<{
  kind: "route";
  match: "exact" | "prefix";
  path: string;
}>;

export type EvryActionSelector =
  | Readonly<{
      kind: "action-source";
      match: "exact" | "prefix";
      source: string;
    }>
  | Readonly<{
      kind: "action-identity";
      identity: string;
    }>
  | Readonly<{
      kind: "application-capability";
      capability: Capability;
    }>;

export type EvryParitySelector = EvryRouteSelector | EvryActionSelector;

/**
 * One module's contribution to EV-001's generated parity contract.
 *
 * The identity is global across every discovered `parity.ts` file. A selector
 * classifies source surfaces; it is not an executor and grants no authority.
 * Action entries retain the application's authoritative {@link Capability}
 * separately, so later Evry capability packs can enforce the same permission.
 */
export type EvryParityCapability = Readonly<{
  id: string;
  classification: EvryParityClassification;
  selectors: readonly EvryParitySelector[];
}>;

/** Preserve literal identities while checking a module contribution's shape. */
export function defineEvryParityCapabilities<
  const T extends readonly EvryParityCapability[],
>(...capabilities: T): T {
  return capabilities;
}

export type EvryRouteSurface = Readonly<{
  kind: "route";
  identity: string;
  path: string;
  /** Every page file that establishes this URL, including parallel slots. */
  sources: readonly string[];
}>;

export type EvryActionSurface = Readonly<{
  kind: "action";
  identity: string;
  source: string;
  exportName: string;
  applicationCapability: Capability | null;
  exemption: Readonly<{
    kind: "sessionless" | "non-seat-guard";
    reason: string;
  }> | null;
}>;

export type EvrySourceSurface = EvryRouteSurface | EvryActionSurface;

export type EvryParityEntry = EvrySourceSurface &
  Readonly<{
    parityCapability: string;
    classification: EvryParityClassification;
  }>;

export type EvryParityInventory = Readonly<{
  schemaVersion: 1;
  generatedBy: "pnpm evry:inventory";
  authoritativeSources: Readonly<{
    routes: "src/app/**/page.tsx";
    guardedActions: "src/lib/auth/capability-map.ts";
    exemptActions: "src/lib/auth/seat-rules.ts#UNSEATED_EXPORTS";
  }>;
  registries: Readonly<{
    plantNavigation: readonly string[];
    settingsSections: readonly Readonly<{
      id: string;
      label: string;
      keywords: readonly string[];
    }>[];
  }>;
  capabilities: readonly Readonly<{
    id: string;
    classification: EvryParityClassification;
  }>[];
  entries: readonly EvryParityEntry[];
  summary: Readonly<{
    routes: number;
    actions: number;
    supported: number;
    excluded: number;
    unreachable: number;
    unclassified: 0;
  }>;
}>;
