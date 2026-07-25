import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { churches, plantSignals, type PlantSignal } from "@/db/schema";

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

/**
 * Validates a manual signal attestation. A self-attestation value is a boolean
 * toggle, a short string, or a number — stored as JSON in `plant_signals.value`.
 * Kept here (not in the "use server" action) so it is unit-testable.
 */
export const setManualSignalSchema = z.object({
  signalKey: z
    .string()
    .trim()
    .min(1, "Signal key is required")
    .max(100, "Signal key is too long"),
  value: z.union([z.boolean(), z.string().max(1000), z.number()]),
});

export type SetManualSignalInput = z.infer<typeof setManualSignalSchema>;

// ============================================================================
// Manual self-attestation service (PE-005 / AC-PE-3).
//
// Planters attest facts the system cannot observe (e.g. "values documented",
// "financial base in place", "systems tested"). Each (church, signal_key) holds
// a single current value; we upsert and record who/when. Saving an attestation
// marks the plant "dirty" (bumps churches.last_material_event_at) so the next
// scheduled assessment re-runs with the new fact in its snapshot.
//
// Computed facts are NEVER stored here — they are derived at assessment time.
// Every operation is church_id-scoped (NFR-PE-6).
// ============================================================================

/**
 * Upsert a manual signal attestation for a church and mark the plant dirty.
 *
 * - Writes one current value per (church_id, signal_key) via the unique index.
 * - Records `attested_by_id` / `attested_at` (who + when) on every write.
 * - Bumps `churches.last_material_event_at` so the plant is re-assessed next run
 *   (the attestation feeds the next assessment's fact snapshot — AC-PE-3).
 *
 * The two writes run sequentially: the neon-http driver does not support
 * interactive transactions. The upsert is the durable record; the dirty mark is
 * a monotonic timestamp bump, so a failure between them only risks a missed
 * re-assessment trigger (the next material event re-marks the plant), never a
 * lost attestation. The upsert runs first so the fact is persisted before the
 * trigger that will read it.
 *
 * @param churchId  Tenant scope. The caller must have verified access.
 * @param attestedById  User recording the attestation.
 * @param input  The signal key + value to attest.
 * @returns The persisted (inserted or updated) plant signal row.
 */
export async function upsertManualSignal(
  churchId: string,
  attestedById: string,
  input: SetManualSignalInput
): Promise<PlantSignal> {
  const now = new Date();

  const [signal] = await db
    .insert(plantSignals)
    .values({
      churchId,
      signalKey: input.signalKey,
      value: input.value,
      attestedById,
      attestedAt: now,
    })
    .onConflictDoUpdate({
      target: [plantSignals.churchId, plantSignals.signalKey],
      set: {
        value: input.value,
        attestedById,
        attestedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  // Mark the plant dirty so the attestation is reflected in the next
  // assessment's reasoning (AC-PE-3). A last_material_event_at newer than the
  // latest assessment's generated_at is what the scheduler treats as dirty.
  await db
    .update(churches)
    .set({ lastMaterialEventAt: now })
    .where(eq(churches.id, churchId));

  return signal;
}

/**
 * List all manual signal attestations for a church (church_id-scoped).
 */
export async function listManualSignals(
  churchId: string
): Promise<PlantSignal[]> {
  return db
    .select()
    .from(plantSignals)
    .where(eq(plantSignals.churchId, churchId));
}

/**
 * Read a single manual signal attestation by key for a church.
 * Returns null when the signal has never been attested.
 */
export async function getManualSignal(
  churchId: string,
  signalKey: string
): Promise<PlantSignal | null> {
  const [signal] = await db
    .select()
    .from(plantSignals)
    .where(
      and(
        eq(plantSignals.churchId, churchId),
        eq(plantSignals.signalKey, signalKey)
      )
    )
    .limit(1);

  return signal ?? null;
}
