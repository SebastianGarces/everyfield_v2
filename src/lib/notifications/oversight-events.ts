import { eq, gt, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { churches, phaseTransitions } from "@/db/schema";
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
 * The SAME rule, for a query that counts rows instead of judging one event.
 *
 * It lives here, touching `isPhaseAdvance`, because the two paths that ask
 * "was this an advance?" — the milestone emitter below and the digest's
 * `stagesReached` count in `./oversight-digest.ts` — got different answers once
 * already. The digest counted every `phase_transitions` row, so a planter
 * correcting stage 3 back to 2 read as "1 new stage" in tomorrow's summary: the
 * event this file deliberately withholds, leaking through the other door and
 * mislabelled as its opposite.
 *
 * Two expressions of one rule is the most that can be shared — drizzle cannot
 * run a TypeScript predicate inside Postgres — so they are kept adjacent, and
 * `oversight-events.test.ts` asserts they agree on the same table of pairs.
 */
export function phaseAdvanceCondition(): SQL {
  return gt(phaseTransitions.toPhase, phaseTransitions.fromPhase);
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
