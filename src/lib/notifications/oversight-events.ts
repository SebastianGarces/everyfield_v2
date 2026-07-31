import { eq } from "drizzle-orm";

import { db } from "@/db";
import { churches } from "@/db/schema";
import type { PhaseChangedEvent } from "@/lib/phase-engine/events";

import { announcePhaseAdvanced } from "./oversight";

// ============================================================================
// F11's event handlers — the milestone emitters that hang off the bus.
//
// A separate file from `./oversight.ts` so `src/lib/events/subscriptions.ts`
// imports a handler and nothing else: the composition module stays importable
// by a script or a test without dragging the bus in behind it.
// ============================================================================

/**
 * Is this phase change a milestone?
 *
 * Only an ADVANCE is. A regression is a correction the planter made to their
 * own record, and reporting it outward turns a correction into an event the
 * planter has to explain — which is exactly the pressure that makes people stop
 * correcting their records. A skip (forward by more than one) is still an
 * advance and is announced once, for the stage actually reached. A no-op is
 * nothing.
 *
 * Pure, so the rule is testable without a database.
 */
export function isPhaseAdvance(fromPhase: number, toPhase: number): boolean {
  return toPhase > fromPhase;
}

/**
 * `phase.changed` → the oversight "reached a new stage" milestone (N-025).
 *
 * Never throws: a handler that threw would surface in the phase transition that
 * emitted the event, and a notification must not be able to fail a transition.
 */
export async function handlePhaseChangedForOversight(
  event: PhaseChangedEvent
): Promise<void> {
  try {
    if (!isPhaseAdvance(event.fromPhase, event.toPhase)) return;

    const [plant] = await db
      .select({ name: churches.name })
      .from(churches)
      .where(eq(churches.id, event.churchId))
      .limit(1);

    if (!plant) return;

    await announcePhaseAdvanced({
      churchId: event.churchId,
      plantName: plant.name,
      toPhase: event.toPhase,
    });
  } catch (error) {
    console.error("oversight phase milestone failed", {
      churchId: event.churchId,
      toPhase: event.toPhase,
      error,
    });
  }
}
