// ============================================================================
// Phase Engine — event payloads (PE-009).
//
// This module OWNS the phase-engine event payload *shapes* and the typed
// emitters. The central registry (src/lib/events/types.ts) and the subscription
// wiring (src/lib/events/subscriptions.ts) are intentionally NOT touched here —
// the PE-event-wiring unit folds these payloads into `AppEvent` and registers
// handlers in a later wave. Until then these emitters fire into the bus and are
// simply unhandled (the bus no-ops on zero handlers).
//
// Two events are defined:
//   - `plant.assessment.created` — emitted after a judge run completes and its
//     snapshot + insights are persisted (PE-009). Consumers (e.g. notifications,
//     oversight rollups) react to a fresh assessment landing.
//   - `phase.changed` — emitted when a plant's phase changes. Defined HERE so
//     the payload contract lives with the feature, even though the transition
//     writer that emits it is owned by another unit.
// ============================================================================

import { eventBus } from "@/lib/events/event-bus";

// ----------------------------------------------------------------------------
// Event payloads
// ----------------------------------------------------------------------------

/**
 * Emitted after a Plant Intelligence assessment completes and is persisted.
 * Carries only IDs + audit metadata — never insight bodies — so handlers stay
 * cheap and privacy-safe (they re-read tenant-scoped rows if they need detail).
 */
export interface PlantAssessmentCreatedEvent {
  type: "plant.assessment.created";
  assessmentId: string;
  churchId: string;
  phase: number;
  rubricVersion: string;
  /** Model id of record for the judge run (audit/tracing). */
  modelId: string | null;
  /** How many insights were persisted across all audiences. */
  insightCount: number;
  timestamp: Date;
}

/**
 * Emitted when a plant's phase changes (PE-001/002/003). The transition writer
 * that emits this is owned by another unit; the payload contract lives here.
 */
export interface PhaseChangedEvent {
  type: "phase.changed";
  churchId: string;
  fromPhase: number;
  toPhase: number;
  /** User who initiated the transition. */
  initiatedById: string;
  rubricVersion: string;
  timestamp: Date;
}

// ----------------------------------------------------------------------------
// Emitters
// ----------------------------------------------------------------------------

/** Emit `plant.assessment.created` after a successful, persisted judge run. */
export async function emitPlantAssessmentCreated(
  payload: Omit<PlantAssessmentCreatedEvent, "type" | "timestamp">
): Promise<void> {
  await eventBus.emit<PlantAssessmentCreatedEvent>({
    type: "plant.assessment.created",
    timestamp: new Date(),
    ...payload,
  });
}

/** Emit `phase.changed`. Provided here so emitters share one payload contract. */
export async function emitPhaseChanged(
  payload: Omit<PhaseChangedEvent, "type" | "timestamp">
): Promise<void> {
  await eventBus.emit<PhaseChangedEvent>({
    type: "phase.changed",
    timestamp: new Date(),
    ...payload,
  });
}
