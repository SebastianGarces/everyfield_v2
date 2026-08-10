import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { phaseTransitions } from "@/db/schema";
import type { PhaseTransitionKind } from "@/db/schema/phase-engine";
import { PHASES, type PhaseNumber } from "@/lib/constants";
import type { PhaseChangedEvent } from "@/lib/phase-engine/events";

import { importTaskTemplate, planTemplateImport } from "./import";
import {
  TASK_TEMPLATES,
  taskTemplateSize,
  type TaskTemplate,
} from "./templates";

// ============================================================================
// T-020 — the phase-triggered template prompt.
//
// PROMPT, NEVER AUTO-CREATE. A planter who advances a stage and finds twenty
// tasks they did not ask for stops trusting the tool with the ones they did.
// So a phase change creates NOTHING: it makes the stage's checklists visible
// with their real dates already worked out, and the planter presses or does
// not. `handlePhaseChangedForTemplatePrompt` below is the seam where
// auto-creation would go, and it deliberately writes nothing — the test beside
// it asserts a phase change leaves the tasks table alone.
//
// THE PROMPT IS DERIVED, NOT STORED. There is no `phase_prompts` table and no
// migration: `phase_transitions` already records, durably and append-only,
// that a plant moved and when. The prompt is a pure function of the latest
// such row plus the code-defined catalog, so it cannot go stale, cannot be
// half-written by a failed handler, and needs nothing back-filled for the
// plants that transitioned before this shipped.
//
// DATES ARE RELATIVE TO THE TRANSITION, NOT TO THE PRESS. `planTemplateImport`
// is handed `transition.createdAt`, so a planter who answers the prompt three
// days after moving gets a checklist counted from the move — the same schedule
// they would have got by answering immediately. The alternative (counting from
// the press) quietly punishes anyone who thought about it first.
//
// WHAT AN ANSWER IS RECORDED IN. The one thing that is NOT derivable is "this
// planter already said no". That is recorded in a cookie holding the answered
// transition's id (`PHASE_TEMPLATE_PROMPT_COOKIE`), which is why the prompt
// re-arms by itself: the NEXT transition has a different id, so the stored
// answer stops matching and the prompt returns. See
// `src/components/tasks/phase-template-prompt.tsx` for the write, and the
// residual this carries — a decline is per-browser, so declining on a laptop
// does not silence the prompt on a phone. A durable, cross-device answer needs
// a column and a migration; a prompt is not worth one.
// ============================================================================

/** Holds the id of the transition whose prompt has been answered. */
export const PHASE_TEMPLATE_PROMPT_COOKIE = "ef_phase_template_prompt";

/** A year. The prompt only ever asks about the LATEST transition, so a stale
 *  value simply stops matching — it never has to be cleaned up. */
export const PHASE_TEMPLATE_PROMPT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * `kind = 'transition'` IS PART OF THE QUESTION, not a refinement of it.
 *
 * `phase_transitions` is two populations (`memory/invariants.md` → Phase
 * History). The OB-005 `initial_declaration` row says where a plant ALREADY
 * stood when it arrived — nobody moved anywhere, and prompting a brand-new
 * planter mid-onboarding with a checklist import is exactly the surprise this
 * feature exists to avoid.
 */
const TRANSITION_KIND: PhaseTransitionKind = "transition";

// ----------------------------------------------------------------------------
// The catalog side
// ----------------------------------------------------------------------------

/**
 * The templates that belong to a phase, in catalog order.
 *
 * Returns `[]` for a phase the catalog says nothing about, which is what makes
 * "a phase with no templates prompts nothing" fall out of the data rather than
 * out of a special case. Every phase 0–6 carries a template today
 * (`templates.test.ts` asserts it), so the empty answer is the guard for a
 * phase number the catalog has not caught up with.
 */
export function phaseTemplatesFor(phase: number): TaskTemplate[] {
  return TASK_TEMPLATES.filter((template) => template.phase === phase);
}

// ----------------------------------------------------------------------------
// The prompt
// ----------------------------------------------------------------------------

/** One checklist the prompt is offering, with its dates already worked out. */
export interface PhaseTemplateOffer {
  key: string;
  name: string;
  description: string;
  taskCount: number;
  /** `YYYY-MM-DD`, counted from the transition — not from today. */
  firstDueDate: string;
  lastDueDate: string;
}

export interface PhaseTemplatePrompt {
  /** The transition being answered. Answering stores this id. */
  transitionId: string;
  fromPhase: number;
  toPhase: number;
  /** From `PHASES`, the one place a phase is named. */
  phaseName: string;
  transitionedAt: Date;
  offers: PhaseTemplateOffer[];
  /** How many tasks accepting everything would create. */
  totalTaskCount: number;
}

/** The columns the prompt reads. A row shape, so the pure half needs no DB. */
export interface PhaseTransitionRow {
  id: string;
  fromPhase: number;
  toPhase: number;
  createdAt: Date;
}

/**
 * What the prompt shows for this transition — or `null` for "prompt nothing".
 *
 * Pure, so the whole decision (including the relative dates) is testable at any
 * clock value with no database anywhere near it. There are four ways to get
 * `null`, and each is a real case rather than a defensive one:
 *
 *   - no transition yet — a plant that has never moved has nothing to be
 *     prompted about;
 *   - the move went nowhere (`toPhase === fromPhase`) — a no-op correction is
 *     not a stage change;
 *   - the planter already answered THIS transition;
 *   - the new phase has no templates.
 *
 * A BACKWARD move still prompts. A planter who moves from 3 back to 2 is doing
 * phase-2 work and wants the phase-2 checklist; "advance" is the notification
 * milestone's rule (it announces progress), not this one.
 */
export function buildPhaseTemplatePrompt(
  transition: PhaseTransitionRow | null,
  answeredTransitionId: string | null
): PhaseTemplatePrompt | null {
  if (!transition) return null;
  if (transition.toPhase === transition.fromPhase) return null;
  if (answeredTransitionId && answeredTransitionId === transition.id) {
    return null;
  }

  const templates = phaseTemplatesFor(transition.toPhase);
  if (templates.length === 0) return null;

  const offers = templates.map((template) => {
    // The SAME function the import runs, given the SAME instant, so the dates
    // the prompt promises are the dates the import writes.
    const plan = planTemplateImport(template, transition.createdAt);
    const dueDates = plan.tasks.map((task) => task.dueDate).sort();

    return {
      key: template.key,
      name: template.name,
      description: template.description,
      taskCount: taskTemplateSize(template),
      firstDueDate: dueDates[0] ?? plan.importedOn,
      lastDueDate: dueDates.at(-1) ?? plan.importedOn,
    };
  });

  return {
    transitionId: transition.id,
    fromPhase: transition.fromPhase,
    toPhase: transition.toPhase,
    phaseName:
      PHASES[transition.toPhase as PhaseNumber] ??
      `Phase ${transition.toPhase}`,
    transitionedAt: transition.createdAt,
    offers,
    totalTaskCount: offers.reduce((total, offer) => total + offer.taskCount, 0),
  };
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

/**
 * The plant's most recent MOVE, church-scoped.
 *
 * `id` breaks the tie on `created_at`, because a plant can be moved twice in
 * one clock tick and "the latest transition" must be one row every time —
 * otherwise the id stored by an answer may not be the id the next render
 * derives, and the prompt would flicker back.
 */
export async function getLatestPhaseTransition(
  churchId: string
): Promise<PhaseTransitionRow | null> {
  if (!churchId) return null;

  const [row] = await db
    .select({
      id: phaseTransitions.id,
      fromPhase: phaseTransitions.fromPhase,
      toPhase: phaseTransitions.toPhase,
      createdAt: phaseTransitions.createdAt,
    })
    .from(phaseTransitions)
    .where(
      and(
        eq(phaseTransitions.churchId, churchId),
        eq(phaseTransitions.kind, TRANSITION_KIND)
      )
    )
    .orderBy(desc(phaseTransitions.createdAt), desc(phaseTransitions.id))
    .limit(1);

  return row ?? null;
}

/** The prompt for a church, or `null` when there is nothing to prompt. */
export async function getPhaseTemplatePrompt(
  churchId: string,
  answeredTransitionId: string | null
): Promise<PhaseTemplatePrompt | null> {
  const transition = await getLatestPhaseTransition(churchId);
  return buildPhaseTemplatePrompt(transition, answeredTransitionId);
}

// ----------------------------------------------------------------------------
// The write
// ----------------------------------------------------------------------------

export interface AcceptPhaseTemplatePromptInput {
  churchId: string;
  /** Who pressed Import. Creator and default assignee, via the T-011 path. */
  userId: string;
  /** Which checklists to take. Anything not on offer is dropped, not honoured. */
  templateKeys: readonly string[];
}

export interface AcceptPhaseTemplatePromptResult {
  transitionId: string;
  /** The calendar day the offsets were counted from — the TRANSITION's day. */
  importedOn: string;
  createdCount: number;
  templateNames: string[];
}

/**
 * Accept the prompt: import the chosen checklists through the T-011 path, with
 * every due date counted from the transition.
 *
 * THE PROMPT IS RE-DERIVED HERE, from the database, and the request's list of
 * keys is filtered against it. The keys arrive from a browser, so a forged
 * request can name a checklist from any phase — or from a phase this plant has
 * never reached. Re-deriving turns that into a no-op instead of a private
 * import path that bypasses the picker. It also closes the window where the
 * plant moved again between the render and the press: the answer then applies
 * to the CURRENT transition, dated from it, which is the only answer that is
 * still true.
 *
 * Returns `null` when there is nothing to accept — no live prompt, or no
 * requested key survived the filter. The caller treats `null` as "leave the
 * prompt up": nothing was created, so nothing has been answered.
 */
export async function acceptPhaseTemplatePrompt(
  input: AcceptPhaseTemplatePromptInput
): Promise<AcceptPhaseTemplatePromptResult | null> {
  const transition = await getLatestPhaseTransition(input.churchId);
  const prompt = buildPhaseTemplatePrompt(transition, null);
  if (!transition || !prompt) return null;

  const requested = new Set(input.templateKeys);
  // Offer order, not request order: `importTaskTemplate` stamps `created_at`
  // per row, and the sets should land in the order the planter saw them.
  const keys = prompt.offers
    .map((offer) => offer.key)
    .filter((key) => requested.has(key));

  if (keys.length === 0) return null;

  let createdCount = 0;
  const templateNames: string[] = [];
  let importedOn = "";

  for (const templateKey of keys) {
    const result = await importTaskTemplate({
      churchId: input.churchId,
      userId: input.userId,
      templateKey,
      // The whole point of T-020: relative to the TRANSITION.
      importedAt: transition.createdAt,
    });

    createdCount += result.created.length;
    templateNames.push(result.templateName);
    importedOn = result.importedOn;
  }

  return {
    transitionId: transition.id,
    importedOn,
    createdCount,
    templateNames,
  };
}

// ----------------------------------------------------------------------------
// The subscription
// ----------------------------------------------------------------------------

/**
 * `phase.changed` → F5, the integration point the FRD names (§Integration
 * Points, "Subscribe to prompt phase-specific task template import").
 *
 * IT WRITES NOTHING, AND THAT IS THE FEATURE. This is the one place a future
 * author reaches for when "import the phase's tasks automatically" sounds like
 * a kindness. It is not: twenty tasks a planter did not ask for, appearing
 * while they were doing something else, is how a task list stops being theirs.
 * The prompt on `/tasks` is derived from the transition row this event
 * accompanies, so nothing needs to be persisted here for it to appear —
 * `phase-prompt.test.ts` pins both halves, that the handler creates no tasks
 * and that the prompt shows up anyway.
 *
 * Best-effort and silent in production, like every other bus handler: an event
 * handler must never be able to fail the transition that emitted it.
 */
export async function handlePhaseChangedForTemplatePrompt(
  event: PhaseChangedEvent
): Promise<void> {
  const templates = phaseTemplatesFor(event.toPhase);

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[F5] Phase ${event.fromPhase} → ${event.toPhase} for church ${event.churchId}: ` +
        `${templates.length} checklist template(s) will be OFFERED on /tasks. Creating none.`
    );
  }
}
