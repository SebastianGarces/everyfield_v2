import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { churches, plantSignals, type PlantSignal } from "@/db/schema";
// WHAT "dirty" IS, as columns — one definition, spread rather than re-typed.
// This module used to set `{ lastMaterialEventAt: now }` by hand and so quietly
// left `updated_at` behind, which is exactly the drift `plantDirtyColumns`'s own
// docblock exists to prevent.
import { plantDirtyColumns } from "@/lib/phase-engine/dirty-handler";
// The ONE manual-signal vocabulary. Import-free by design, so naming it here
// drags nothing into a browser chunk.
import { MANUAL_SIGNAL_KEYS } from "@/lib/phase-engine/manual-signals";

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

/**
 * Validates a manual signal attestation. A self-attestation value is a boolean
 * toggle, a short string, or a number — stored as JSON in `plant_signals.value`.
 * Kept here (not in the "use server" action) so it is unit-testable.
 *
 * THE KEY IS THE CLOSED VOCABULARY, not any short string. This schema is the
 * only gate in front of the only writer of `plant_signals.signal_key`, and its
 * caller `setManualSignalAction` is an export of a `"use server"` module — a
 * public POST endpoint reachable with no UI. While the key was free-form, the
 * compiler bound all three READERS to `ManualSignalKey` and nothing bound the
 * WRITER: `{signalKey: "systems_testd", value: true}` stored a row, the fact
 * snapshot folded it in as an attested fact of the plant, and its citation
 * de-camelised straight back to the planter as "you confirmed systems testd"
 * with no gate behind it. `z.enum` over `MANUAL_SIGNAL_KEYS` is what makes that
 * unreachable by input, as `ManualSignalKey` already made it unreachable by a
 * developer mistake. `.trim()` stays (a stored key is compared byte for byte);
 * the old min/max messages are gone with the free-form string they described.
 */
export const setManualSignalSchema = z.object({
  signalKey: z.string().trim().pipe(z.enum(MANUAL_SIGNAL_KEYS)),
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
 * BOTH WRITES ARE ONE `db.batch([...])`. They are known up front and touch only
 * our own tables, which is shape 1 in `src/db/index.ts` — so the marker-last
 * ordering the previous version reasoned about does not apply and is not needed
 * (`db.transaction` remains unavailable: neon-http throws). The old shape left
 * an attestation persisted with the plant unmarked, which is not merely "a
 * missed trigger": the attestation is a fact the judge reads out of the NEXT
 * snapshot, so until some unrelated material event landed, the planter's answer
 * changed nothing they could see. All-or-nothing removes the window.
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

  const [[signal]] = await db.batch([
    db
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
      .returning(),
    // Mark the plant dirty so the attestation is reflected in the next
    // assessment's reasoning (AC-PE-3). A last_material_event_at newer than the
    // latest assessment's generated_at is what the scheduler treats as dirty.
    // The SAME `now` the upsert stamps, through the one definition of the
    // columns that mark a plant dirty.
    db
      .update(churches)
      .set(plantDirtyColumns(now))
      .where(eq(churches.id, churchId)),
  ]);

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
