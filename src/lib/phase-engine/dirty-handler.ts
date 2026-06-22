// ============================================================================
// Phase Engine — dirty-marking handler (PE-010 / AC-PE-8).
//
// When a *material* event lands for a plant (church), the plant becomes a
// candidate for (re-)assessment. We record that by stamping
// `churches.last_material_event_at = now`. The selection logic in
// `assessment/dirty.ts` later compares this timestamp against the latest
// assessment's `generated_at` to decide whether the plant is "dirty".
//
// This handler is owned by the phase-engine feature but is MOUNTED in the
// shared `src/lib/events/subscriptions.ts` wiring file — no feature service
// imports another feature's service directly. It is deliberately tenant-scoped
// (only ever touches the affected `churchId`) and best-effort: a failure to
// stamp must never break the event that triggered it, so it swallows + logs.
// ============================================================================

import { db } from "@/db";
import { churches } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Mark a plant dirty by stamping `last_material_event_at = now` for the given
 * church. Idempotent and tenant-scoped: it only ever updates the one church_id.
 *
 * Best-effort by design — material events (attendance finalized, team member
 * assigned, person created, task completed) are the source of truth; failing to
 * mark dirty should degrade re-assessment freshness, never the originating flow.
 */
export async function markPlantDirty(churchId: string): Promise<void> {
  if (!churchId) return;

  try {
    await db
      .update(churches)
      .set({ lastMaterialEventAt: new Date(), updatedAt: new Date() })
      .where(eq(churches.id, churchId));

    if (process.env.NODE_ENV === "development") {
      console.log(`[PE] Marked plant dirty (church ${churchId})`);
    }
  } catch (error) {
    console.error(
      `[PE] Failed to mark plant dirty for church ${churchId}:`,
      error
    );
  }
}

/**
 * Convenience adapter for the event bus: extracts `churchId` from any material
 * event payload and marks the plant dirty. Keeping this signature uniform lets
 * `subscriptions.ts` mount it against every material event with one line each.
 */
export async function handleMaterialEvent(event: {
  churchId: string;
}): Promise<void> {
  await markPlantDirty(event.churchId);
}
