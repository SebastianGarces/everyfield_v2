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
// (only ever touches the affected `churchId`). Ordinary events are best-effort;
// a keyed Evry reconciliation is strict so its terminal outcome means this
// derived state has actually converged.
// ============================================================================

import { db } from "@/db";
import { churches } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * WHAT "dirty" IS, as columns.
 *
 * One definition, so a caller that has its own reason to write the churches row
 * — F12/OB-009 stamps this in the same statement that completes onboarding, to
 * keep "setup finished" and "worth assessing" from ever disagreeing — spreads
 * this instead of re-typing the column name and drifting from `markPlantDirty`.
 * The clock is a parameter so such a caller can share ITS timestamp.
 */
export function plantDirtyColumns(now: Date = new Date()) {
  return { lastMaterialEventAt: now, updatedAt: now };
}

/**
 * Mark a plant dirty by stamping `last_material_event_at = now` for the given
 * church. Idempotent and tenant-scoped: it only ever updates the one church_id.
 *
 * Ordinary owner flows are best-effort because the material event is the
 * source of truth. A durable keyed reconciliation opts into `required`, where
 * a failure remains retryable and cannot be hidden behind a terminal outcome.
 */
export async function markPlantDirty(
  churchId: string,
  options: { occurredAt?: Date; failureMode?: "best_effort" | "required" } = {}
): Promise<void> {
  if (!churchId) return;

  try {
    const occurredAt = options.occurredAt ?? new Date();
    await db
      .update(churches)
      .set({
        lastMaterialEventAt: sql`greatest(coalesce(${churches.lastMaterialEventAt}, ${occurredAt}), ${occurredAt})`,
        updatedAt: sql`greatest(${churches.updatedAt}, ${occurredAt})`,
      })
      .where(eq(churches.id, churchId));

    if (process.env.NODE_ENV === "development") {
      console.log(`[PE] Marked plant dirty (church ${churchId})`);
    }
  } catch (error) {
    console.error(
      `[PE] Failed to mark plant dirty for church ${churchId}:`,
      error
    );
    if (options.failureMode === "required") throw error;
  }
}

/**
 * Convenience adapter for the event bus: extracts `churchId` from any material
 * event payload and marks the plant dirty. Keeping this signature uniform lets
 * `subscriptions.ts` mount it against every material event with one line each.
 */
export async function handleMaterialEvent(event: {
  churchId: string;
  timestamp?: Date;
  occurrenceKey?: string;
}): Promise<void> {
  await markPlantDirty(event.churchId, {
    occurredAt: event.timestamp,
    failureMode: event.occurrenceKey ? "required" : "best_effort",
  });
}
