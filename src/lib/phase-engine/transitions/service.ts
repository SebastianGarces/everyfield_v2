// ============================================================================
// Phase Engine — phase transition service (PE-001/002/003/015).
//
// Soft-gated phase control. A planter may advance, regress, or correct the
// current phase. Transitions are NEVER blocked on readiness — the readiness
// state is advisory only (the rubric's gates inform the planter; the planter
// decides). Every transition:
//   1. Writes an immutable `phase_transitions` row capturing the fact snapshot
//      (Signal layer) + the active rubric version at the moment of transition
//      (PE-002 / AC-PE-1 / NFR-PE-5).
//   2. Updates `churches.current_phase`.
//   3. Emits `phase.changed` for downstream consumers (PE-003).
//
// This module is church_id-scoped (NFR-PE-6). The "use server" action layer
// (../../app/(dashboard)/phase/actions.ts) performs auth + access checks and
// resolves the initiating user before calling `transitionPhase`.
//
// Pure logic (validation, the row builder, readiness derivation) is separated
// from I/O so it is unit-testable without a database.
// ============================================================================

import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  churches,
  phaseTransitions,
  type NewPhaseTransition,
  type PhaseTransition,
} from "@/db/schema";
import { getLatestAssessment } from "@/lib/phase-engine/assessment";
import { emitPhaseChanged } from "@/lib/phase-engine/events";
import { ACTIVE_RUBRIC } from "@/lib/phase-engine/rubric";
import {
  buildFactSnapshot,
  type PlantFactSnapshot,
} from "@/lib/phase-engine/signals";

// ----------------------------------------------------------------------------
// Phase bounds + validation
// ----------------------------------------------------------------------------

/** Lowest valid phase (Discovery). */
export const MIN_PHASE = 0;
/** Highest valid phase (Post-Launch). Mirrors rubric-v0 Part B. */
export const MAX_PHASE = 6;

/** A well-formed phase number, reused by both write paths below. */
const phaseNumberSchema = z
  .number()
  .int("Phase must be an integer")
  .min(MIN_PHASE, `Phase must be >= ${MIN_PHASE}`)
  .max(MAX_PHASE, `Phase must be <= ${MAX_PHASE}`);

// ----------------------------------------------------------------------------
// Initial declaration (OB-005) — a phase-history row that is NOT a transition
// ----------------------------------------------------------------------------

/**
 * The reason constant that marks a `phase_transitions` row as the planter's
 * INITIAL DECLARATION rather than a transition they made (OB-005; FRD
 * `planter-onboarding`, "Data notes" — "a distinguished transition kind or
 * reason constant on the existing phase-transition record. No new table
 * expected.").
 *
 * WHY A REASON CONSTANT AND NOT A COLUMN. The FRD offers both and the constant
 * is the smaller change: `reason` is already `NOT NULL` on every row, already
 * rendered by the history surface, and already the field that explains why a
 * row exists. A new column would need a migration, a back-fill decision for
 * every existing row, and a default that says "transition" — which is exactly
 * what this constant's ABSENCE already says.
 *
 * WHAT MAKES IT A REAL DISCRIMINATOR rather than a convention: it is RESERVED.
 * `transitionPhaseSchema` refuses a planter-typed reason equal to it (below),
 * so the only writer that can produce this string is
 * `declareInitialPhaseStatement`. Without that refusal a planter could type it
 * on `/phase` and manufacture a row `isInitialDeclaration` would misread.
 */
export const INITIAL_DECLARATION_REASON =
  "Declared at setup — where this plant already was when it joined EveryField.";

/**
 * Is this phase-history row the initial declaration (as opposed to a
 * transition the planter performed)? The one predicate — history surfaces,
 * analytics and the onboarding "did they answer step 3?" fact all ask it here
 * so none of them can disagree about what "declared" means.
 */
export function isInitialDeclaration(row: { reason: string }): boolean {
  return row.reason === INITIAL_DECLARATION_REASON;
}

/**
 * Validates a transition request. Kept here (not in the "use server" action) so
 * it is unit-testable. Soft-gated: the *only* constraints are a well-formed
 * target phase and a non-empty reason — readiness is never enforced (PE-001).
 *
 * The one thing a reason may NOT be is `INITIAL_DECLARATION_REASON`: that
 * string is the marker distinguishing "declared at setup" from "moved", and a
 * planter able to type it could forge one. See the constant's note.
 */
export const transitionPhaseSchema = z.object({
  toPhase: phaseNumberSchema,
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required")
    .max(2000, "Reason is too long")
    .refine(
      (reason) => reason !== INITIAL_DECLARATION_REASON,
      "That wording is reserved for the stage you declared when you set up. Say what changed instead."
    ),
});

export type TransitionPhaseInput = z.infer<typeof transitionPhaseSchema>;

/** The stage a planter declares at onboarding. No reason — the row carries one. */
export const initialPhaseDeclarationSchema = z.object({
  phase: phaseNumberSchema,
});

export type InitialPhaseDeclarationInput = z.infer<
  typeof initialPhaseDeclarationSchema
>;

// ----------------------------------------------------------------------------
// Transition direction (pure)
// ----------------------------------------------------------------------------

/** The kind of move relative to the current phase. */
export type TransitionDirection = "advance" | "regress" | "skip" | "noop";

/**
 * Classify a transition by direction. Forward by one = advance; backward = a
 * regression (correction); forward by more than one = skip; same = noop. This
 * is descriptive metadata only — no direction is ever blocked (PE-001).
 */
export function classifyTransition(
  fromPhase: number,
  toPhase: number
): TransitionDirection {
  if (toPhase === fromPhase) return "noop";
  if (toPhase < fromPhase) return "regress";
  return toPhase - fromPhase === 1 ? "advance" : "skip";
}

// ----------------------------------------------------------------------------
// Immutable audit row (pure)
// ----------------------------------------------------------------------------

/** Everything needed to build a `phase_transitions` insert payload. */
export interface BuildTransitionRowInput {
  churchId: string;
  fromPhase: number;
  toPhase: number;
  initiatedById: string;
  reason: string;
  factSnapshot: PlantFactSnapshot;
  rubricVersion: string;
}

/**
 * Build the immutable audit row for a phase transition (PE-002 / AC-PE-1).
 * Pure — captures from/to, the initiating user, the reason, the deterministic
 * fact snapshot (Signal layer), and the active rubric version. The `createdAt`
 * timestamp is assigned by the DB default on insert.
 */
export function buildTransitionRow(
  input: BuildTransitionRowInput
): NewPhaseTransition {
  return {
    churchId: input.churchId,
    fromPhase: input.fromPhase,
    toPhase: input.toPhase,
    initiatedById: input.initiatedById,
    reason: input.reason,
    factSnapshot: input.factSnapshot,
    rubricVersion: input.rubricVersion,
  };
}

// ----------------------------------------------------------------------------
// Readiness derivation (pure) — PE-015
// ----------------------------------------------------------------------------

/**
 * Readiness state for the current phase, derived from the latest assessment's
 * readiness insight. Advisory only — surfaced in the phase-control UI so the
 * planter sees the rubric's gate read, but it NEVER blocks a transition.
 */
export interface PhaseReadiness {
  /** Whether a readiness signal could be derived at all. */
  hasAssessment: boolean;
  /**
   * Coarse readiness for advancing out of the current phase, inferred from the
   * severity of the latest `launch_readiness` / `phase_progress` insight:
   *   - "ready"     : no readiness concern raised (positive/info only)
   *   - "approaching": a "watch"-level readiness concern exists
   *   - "not_ready" : an "urgent" readiness concern exists
   *   - "unknown"   : no assessment / no readiness insight yet
   */
  state: "ready" | "approaching" | "not_ready" | "unknown";
  /** The headline of the driving readiness insight, for display. */
  headline: string | null;
  /** The body of the driving readiness insight, for display. */
  detail: string | null;
  /** Assessment id the readiness read came from (audit/trace). */
  assessmentId: string | null;
}

/** Insight categories that speak to readiness/phase progression. */
const READINESS_CATEGORIES = new Set(["launch_readiness", "phase_progress"]);

/** A minimal insight shape — just the fields readiness derivation needs. */
interface ReadinessInsightLike {
  category: string;
  audience: string;
  severity: string;
  title: string;
  body: string;
  rank: number;
}

/**
 * Derive the readiness state from a latest-assessment payload (PE-015). Pure:
 * given the assessment id + its insights, picks the highest-priority
 * planter-facing readiness insight and maps its severity to a coarse state.
 * Returns an "unknown" state when there is no assessment or no readiness insight.
 */
export function deriveReadiness(
  assessmentId: string | null,
  insights: ReadinessInsightLike[]
): PhaseReadiness {
  if (!assessmentId) {
    return {
      hasAssessment: false,
      state: "unknown",
      headline: null,
      detail: null,
      assessmentId: null,
    };
  }

  // Planter-facing readiness insights, highest priority first (lower rank wins).
  const readiness = insights
    .filter(
      (i) => i.audience === "planter" && READINESS_CATEGORIES.has(i.category)
    )
    .sort((a, b) => a.rank - b.rank);

  if (readiness.length === 0) {
    return {
      hasAssessment: true,
      state: "unknown",
      headline: null,
      detail: null,
      assessmentId,
    };
  }

  const driving = readiness[0];
  const state = severityToReadiness(driving.severity);

  return {
    hasAssessment: true,
    state,
    headline: driving.title,
    detail: driving.body,
    assessmentId,
  };
}

/**
 * Map an insight severity to a coarse readiness state.
 *
 * getPhaseReadiness reads PERSISTED insights (via getLatestAssessment), whose
 * severities are the DB vocabulary (info|low|medium|high|critical) the persist
 * layer produced from the judge vocabulary (positive→info, info→low,
 * watch→medium, urgent→high). We map on the DB vocabulary so a judge-"urgent"
 * issue (stored as "high") correctly yields "not_ready" rather than silently
 * falling through to "ready". The raw judge vocabulary is also handled
 * defensively in case a not-yet-persisted insight is passed in.
 */
function severityToReadiness(
  severity: string
): "ready" | "approaching" | "not_ready" {
  switch (severity) {
    // Persisted DB vocabulary (the real runtime path).
    case "critical":
    case "high":
      return "not_ready";
    case "medium":
      return "approaching";
    case "low":
    case "info":
      return "ready";
    // Defensive: raw judge vocabulary.
    case "urgent":
      return "not_ready";
    case "watch":
      return "approaching";
    // positive → no concern raised
    default:
      return "ready";
  }
}

// ----------------------------------------------------------------------------
// Transition (I/O) — PE-001/002/003
// ----------------------------------------------------------------------------

/** Result of a successful phase transition. */
export interface TransitionResult {
  transition: PhaseTransition;
  fromPhase: number;
  toPhase: number;
  direction: TransitionDirection;
}

/** Raised when the target church does not exist. */
export class ChurchNotFoundError extends Error {
  constructor() {
    super("Church not found");
    this.name = "ChurchNotFoundError";
  }
}

/**
 * Transition a plant to `toPhase` with a required `reason` (PE-001/002/003).
 *
 * Soft-gated: forward, backward, and skip moves are all allowed and NEVER
 * blocked. The caller (the action layer) is responsible for verifying that
 * `initiatedById` is a planter with access to `churchId`.
 *
 * Steps:
 *   1. Resolve the church + its current phase (church_id-scoped).
 *   2. Capture the deterministic fact snapshot (Signal layer) + active rubric
 *      version, and write an immutable `phase_transitions` row (AC-PE-1).
 *   3. Update `churches.current_phase`.
 *   4. Emit `phase.changed` for downstream consumers (PE-003).
 *
 * @param churchId       Tenant scope (caller must have verified access).
 * @param initiatedById  The planter initiating the transition.
 * @param input          Validated target phase + reason.
 * @throws ChurchNotFoundError if the church does not exist.
 * @returns The persisted transition row + direction metadata.
 */
export async function transitionPhase(
  churchId: string,
  initiatedById: string,
  input: TransitionPhaseInput
): Promise<TransitionResult> {
  const [church] = await db
    .select({ id: churches.id, currentPhase: churches.currentPhase })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  if (!church) {
    throw new ChurchNotFoundError();
  }

  const fromPhase = church.currentPhase;
  const { toPhase, reason } = input;

  // Deterministic fact snapshot at the moment of transition (Signal layer) +
  // the active rubric version, captured for the immutable audit row (AC-PE-1).
  const factSnapshot = await buildFactSnapshot(churchId);
  const rubricVersion = ACTIVE_RUBRIC.version;

  const [transition] = await db
    .insert(phaseTransitions)
    .values(
      buildTransitionRow({
        churchId,
        fromPhase,
        toPhase,
        initiatedById,
        reason,
        factSnapshot,
        rubricVersion,
      })
    )
    .returning();

  // Move the plant to the new phase.
  await db
    .update(churches)
    .set({ currentPhase: toPhase })
    .where(eq(churches.id, churchId));

  // Notify downstream consumers (PE-003). The event bus no-ops on zero handlers
  // until the PE-event-wiring unit registers them.
  await emitPhaseChanged({
    churchId,
    fromPhase,
    toPhase,
    initiatedById,
    rubricVersion,
  });

  return {
    transition,
    fromPhase,
    toPhase,
    direction: classifyTransition(fromPhase, toPhase),
  };
}

// ----------------------------------------------------------------------------
// Initial declaration (I/O) — OB-005
// ----------------------------------------------------------------------------

/**
 * ONE row, never a ladder — the whole point of OB-005.
 *
 * A planter who arrives mid-journey and says "we are at phase 3" did not walk
 * 0→1→2→3 inside this product, and the obvious implementation — a loop calling
 * `transitionPhase` for each step — would write three rows claiming they did.
 * That is fabricated history: it would put dates on transitions that never
 * happened, capture three identical fact snapshots seconds apart, and make
 * every "how long did this plant spend in phase 1?" analytic a lie. So the
 * declaration is a SINGLE insert whose `to_phase` is the declared phase and
 * whose `from_phase` is wherever the row already sat (0 at onboarding), marked
 * with `INITIAL_DECLARATION_REASON`.
 *
 * THE GUARDS, in order:
 *
 *   `current`   `SELECT … FOR UPDATE` on the church row — the row the update at
 *               the end of this statement writes, so it is a real lock and not
 *               a snapshot predicate. Two submits (a double click, a second
 *               tab) serialise here; the second re-reads what the first
 *               committed (memory/invariants.md → Atomicity).
 *   `declared`  the insert. It reads `from current c`, so `current` is a
 *               DEPENDENCY and is evaluated — and the row locked — BEFORE
 *               anything modifies it. Written as a lazy sibling instead, the
 *               CTE would be pulled only after the UPDATE and a re-read would
 *               skip the tuple its own command just wrote
 *               (`HeapTupleSelfUpdated`), landing a row with a false
 *               `from_phase`. Same trap, same fix, as `setLaunchDateStatement`.
 *               `NOT EXISTS` makes the declaration once-only: a planter may
 *               revisit step 3, but the FIRST answer is the one that is
 *               history, and later corrections are ordinary transitions on
 *               `/phase` with their own reasons.
 *   `moved`     `update churches … from declared d` — sourced from the insert,
 *               so `current_phase` can only move when a declaration row
 *               actually landed. A refused (already-declared) call writes
 *               nothing at all, including no phase change.
 *
 * The final SELECT returns zero rows when the declaration was refused, which
 * the caller reports as `already_declared` rather than as a failure.
 */
export function declareInitialPhaseStatement(input: {
  churchId: string;
  toPhase: number;
  initiatedById: string;
  factSnapshot: PlantFactSnapshot;
  rubricVersion: string;
}): SQL {
  return sql`
    with current as (
      select id, current_phase
      from churches
      where id = ${input.churchId}
      for update
    ), declared as (
      insert into phase_transitions (
        church_id, from_phase, to_phase, initiated_by_id, reason,
        fact_snapshot, rubric_version
      )
      select
        c.id,
        c.current_phase,
        ${input.toPhase}::integer,
        ${input.initiatedById}::uuid,
        ${INITIAL_DECLARATION_REASON}::text,
        ${JSON.stringify(input.factSnapshot)}::jsonb,
        ${input.rubricVersion}::varchar
      from current c
      where not exists (
        select 1
        from phase_transitions p
        where p.church_id = c.id
          and p.reason = ${INITIAL_DECLARATION_REASON}
      )
      returning id, from_phase, to_phase, created_at
    ), moved as (
      update churches ch
      set current_phase = ${input.toPhase}::integer,
          updated_at = now()
      from declared d
      where ch.id = ${input.churchId}
      returning ch.id
    )
    select
      d.id as transition_id,
      d.from_phase as from_phase,
      d.to_phase as to_phase
    from declared d
  `;
}

interface DeclarationRow extends Record<string, unknown> {
  transition_id: string;
  from_phase: number;
  to_phase: number;
}

/** What a declaration attempt did. */
export type DeclareInitialPhaseResult =
  | {
      status: "declared";
      transitionId: string;
      fromPhase: number;
      phase: number;
    }
  /** A declaration already exists — the first answer is the one that is history. */
  | { status: "already_declared"; phase: number };

/**
 * Record the planter's own read of where this plant already is (OB-005).
 *
 * Sets `churches.current_phase` and writes ONE `phase_transitions` row marked
 * as the initial declaration. No intermediate rows are synthesised — declaring
 * 3 produces nothing for 1 and 2 (FRD AC 3), which is a property of the
 * statement above and is pinned by `service.test.ts`.
 *
 * The caller (the onboarding action) is responsible for verifying that
 * `initiatedById` is a planter with access to `churchId`.
 *
 * @throws ChurchNotFoundError if the church does not exist.
 */
export async function declareInitialPhase(
  churchId: string,
  initiatedById: string,
  input: InitialPhaseDeclarationInput
): Promise<DeclareInitialPhaseResult> {
  const { phase } = initialPhaseDeclarationSchema.parse(input);

  const [church] = await db
    .select({ id: churches.id, currentPhase: churches.currentPhase })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  if (!church) {
    throw new ChurchNotFoundError();
  }

  // The same snapshot every transition captures (AC-PE-1). Taken AFTER the
  // launch date has been written by the caller, so the row records the plant as
  // it stands at the moment it is declared — countdown included — rather than
  // as it stood one write earlier.
  const factSnapshot = await buildFactSnapshot(churchId);

  const result = await db.execute<DeclarationRow>(
    declareInitialPhaseStatement({
      churchId,
      toPhase: phase,
      initiatedById,
      factSnapshot,
      rubricVersion: ACTIVE_RUBRIC.version,
    })
  );

  const written = result.rows[0];

  if (!written) {
    // Refused by the `NOT EXISTS` guard: this plant has already declared. Its
    // stored phase is the answer, not the one just submitted — nothing moved.
    return { status: "already_declared", phase: church.currentPhase };
  }

  // PE-003. Emitted only when the phase actually MOVED: "not sure — start me at
  // the beginning" on a plant already at 0 is a declaration worth recording and
  // a `phase.changed` that would be false.
  if (written.from_phase !== written.to_phase) {
    await emitPhaseChanged({
      churchId,
      fromPhase: written.from_phase,
      toPhase: written.to_phase,
      initiatedById,
      rubricVersion: ACTIVE_RUBRIC.version,
    });
  }

  return {
    status: "declared",
    transitionId: written.transition_id,
    fromPhase: written.from_phase,
    phase: written.to_phase,
  };
}

/**
 * Has this plant recorded its initial declaration (OB-005)?
 *
 * The onboarding "did they answer step 3?" fact. It is asked of phase HISTORY
 * and not of `churches.current_phase` or of the launch row, because the honest
 * answer to "not sure, and no date yet" leaves both of those exactly as a
 * planter who never saw the step would leave them.
 */
export async function hasInitialPhaseDeclaration(
  churchId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: phaseTransitions.id })
    .from(phaseTransitions)
    .where(
      and(
        eq(phaseTransitions.churchId, churchId),
        eq(phaseTransitions.reason, INITIAL_DECLARATION_REASON)
      )
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Read the readiness state for a church's current phase (PE-015). Derived from
 * the latest COMPLETE assessment's readiness insight — no LLM call. Advisory
 * only; surfaced in the phase-control UI alongside the transition control.
 *
 * @param churchId Tenant scope (caller must have verified access).
 */
export async function getPhaseReadiness(
  churchId: string
): Promise<PhaseReadiness> {
  const latest = await getLatestAssessment(churchId);
  if (!latest) {
    return deriveReadiness(null, []);
  }
  return deriveReadiness(latest.assessment.id, latest.insights);
}
