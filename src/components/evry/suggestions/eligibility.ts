import type { Capability } from "@/lib/auth/seat-rules";
import type { EvryParityInventory } from "@/lib/evry/capabilities/contract";

import { EVRY_SUGGESTION_CATALOG } from "./catalog";
import type { EligibleEvrySuggestion } from "./types";

/**
 * Inventory-backed eligibility, run on the server before suggestions cross
 * the RSC boundary. An entry needs a supported route, a supported action
 * carrying the same application capability, and that capability in the
 * actor's held set.
 */
export function eligibleEvrySuggestions(
  enabled: boolean,
  heldCapabilities: readonly Capability[],
  inventory: EvryParityInventory
): readonly EligibleEvrySuggestion[] {
  if (!enabled) return [];

  const held = new Set(heldCapabilities);
  const supportedRoutes = new Set(
    inventory.entries.flatMap((entry) =>
      entry.kind === "route" && entry.classification.state === "supported"
        ? [entry.parityCapability]
        : []
    )
  );
  const supportedActions = new Set(
    inventory.entries.flatMap((entry) =>
      entry.kind === "action" &&
      entry.classification.state === "supported" &&
      entry.applicationCapability
        ? [`${entry.parityCapability}:${entry.applicationCapability}`]
        : []
    )
  );

  return EVRY_SUGGESTION_CATALOG.filter(
    (suggestion) =>
      held.has(suggestion.requiredCapability) &&
      supportedRoutes.has(suggestion.module) &&
      supportedActions.has(
        `${suggestion.module}:${suggestion.requiredCapability}`
      )
  ).map(({ id, module, request, fallback }) => ({
    id,
    module,
    request,
    fallback,
  }));
}
