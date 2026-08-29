import "server-only";

import inventoryJson from "@/lib/evry/capabilities/inventory.generated.json";
import type { EvryParityInventory } from "@/lib/evry/capabilities/contract";
import type { Capability } from "@/lib/auth/seat-rules";

import { eligibleEvrySuggestions } from "./eligibility";

export function evrySuggestionsForActor(
  enabled: boolean,
  capabilities: readonly Capability[]
) {
  return eligibleEvrySuggestions(
    enabled,
    capabilities,
    inventoryJson as EvryParityInventory
  );
}
