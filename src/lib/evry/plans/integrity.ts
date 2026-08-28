import { fingerprintEvryActionPlan } from "./fingerprint";
import type { StoredEvryActionPlan } from "./repository";
import type { EvryPlanCapabilityRegistry } from "./registry";
import { parseStoredEvryActionPlan } from "./schema";

/** Reparse persisted JSON and require its canonical digest to remain exact. */
export function validateStoredEvryActionPlan(
  stored: StoredEvryActionPlan,
  registry: EvryPlanCapabilityRegistry
): boolean {
  try {
    const document = parseStoredEvryActionPlan({
      document: stored.document,
      registry,
    });
    return (
      fingerprintEvryActionPlan({
        actorUserId: stored.actorUserId,
        plantId: stored.plantId,
        expiresAt: stored.expiresAt,
        document,
      }) === stored.fingerprint
    );
  } catch {
    return false;
  }
}
