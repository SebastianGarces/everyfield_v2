import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { phasePromptAnswers, phaseTransitions } from "@/db/schema";
import type { PhaseTransitionKind } from "@/db/schema/phase-engine";
import type { PhasePromptAnswerKind } from "@/db/schema/tasks";
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
// WHAT AN ANSWER IS RECORDED IN — A ROW, KEYED BY TRANSITION ID (ruled
// 2026-08-10 on PR #393). The one thing that is NOT derivable is "this planter
// already answered", and it now lives in `phase_prompt_answers`, one row per
// transition, unique on `transition_id` (migration 0035). That is what makes
// the answer follow the PLANTER rather than the browser: declining on a laptop
// silences the prompt on a phone, and pressing Import a second time — on a
// second device, after clearing cookies, or by double-clicking — adds nothing.
// The prompt still re-arms by itself, because the NEXT transition is a
// different id with no row against it.
//
// THE COOKIE SURVIVES AS A FAST PATH ONLY. `PHASE_TEMPLATE_PROMPT_COOKIE` is
// still written and still read, but it can only ever suppress a prompt the row
// suppresses too; the row is authoritative, and the accept path does not
// consult the cookie at all. See
// `src/components/tasks/phase-template-prompt.tsx` for the writes.
//
// THE CLAIM IS THE FIRST WRITE, NOT THE LAST. `memory/invariants.md` →
// Transactions normally says "write the durable marker LAST, every earlier step
// idempotent". Importing a checklist is NOT idempotent — T-012 creates a second
// copy by design — so a marker written afterwards is written after the damage,
// and a SELECT-then-INSERT read in front of it is not a concurrency guard
// either. `acceptPhaseTemplatePrompt` therefore claims the answer row with
// `ON CONFLICT DO NOTHING` and imports only if the claim returned a row.
// ============================================================================

/**
 * Fast path for "this browser already answered".
 *
 * Kept because it costs nothing and answers before the database does, but it is
 * no longer the record: `phase_prompt_answers` is, and a browser with no cookie
 * (or a forged one) is answered by the row.
 */
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
  /**
   * When this transition's prompt was answered durably (`phase_prompt_answers`),
   * or `null` for "never answered".
   *
   * Carried on the transition row rather than fetched separately because the
   * two are read by one LEFT JOIN — the answer is a fact ABOUT this transition,
   * and a second round trip would open a window where the prompt renders from a
   * transition the answer no longer belongs to.
   */
  answeredAt?: Date | null;
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
 *   - the planter already answered THIS transition, durably (`answeredAt`) or
 *     in this browser (the cookie);
 *   - the new phase has no templates.
 *
 * THE ROW WINS AND THE COOKIE ONLY ADDS. `answeredAt` comes from
 * `phase_prompt_answers` and is the answer of record on every device; the
 * cookie is a second, weaker way to reach the same "already answered" and can
 * only suppress a prompt, never restore one. That asymmetry is why a forged or
 * stale cookie is harmless: the worst it costs its owner is their own prompt.
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
  if (transition.answeredAt) return null;
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
 * The plant's most recent MOVE, church-scoped, with its durable answer.
 *
 * `id` breaks the tie on `created_at`, because a plant can be moved twice in
 * one clock tick and "the latest transition" must be one row every time —
 * otherwise the id stored by an answer may not be the id the next render
 * derives, and the prompt would flicker back.
 *
 * The answer rides along on a LEFT JOIN rather than a second query. It is a
 * fact about THIS transition, and reading it separately would let the plant
 * move in between, so the render could pair a new transition with an old
 * transition's answer.
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
      answeredAt: phasePromptAnswers.createdAt,
    })
    .from(phaseTransitions)
    .leftJoin(
      phasePromptAnswers,
      eq(phasePromptAnswers.transitionId, phaseTransitions.id)
    )
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

/**
 * The outcome of answering, told apart by `status` because the two are
 * genuinely different events and the caller reacts differently to each.
 *
 * `already_answered` is a SUCCESS: the transition has an answer, so the prompt
 * is done and must come down — it simply created nothing this time.
 */
export type AcceptPhaseTemplatePromptResult =
  | {
      status: "imported";
      transitionId: string;
      /** The calendar day the offsets were counted from — the TRANSITION's day. */
      importedOn: string;
      createdCount: number;
      templateNames: string[];
    }
  | { status: "already_answered"; transitionId: string };

// ----------------------------------------------------------------------------
// The claim
// ----------------------------------------------------------------------------

interface ClaimInput {
  churchId: string;
  transitionId: string;
  userId: string;
  answer: PhasePromptAnswerKind;
}

/**
 * Claim the one answer this transition is allowed, or discover it is taken.
 *
 * Returns the new row's id, or `null` when a row already existed. This is a
 * compare-and-set against `phase_prompt_answers_transition_unique_idx` and NOT
 * a read: `ON CONFLICT DO NOTHING` is decided by the database, so two presses
 * in the same millisecond — two tabs, two devices, a double-click — cannot both
 * come back with a row (`memory/invariants.md` → Transactions).
 *
 * The conflict target is the transition alone, matching the index, so a request
 * that supplied a different `churchId` for the same transition still loses.
 */
async function claimPhaseTemplatePromptAnswer(
  input: ClaimInput
): Promise<string | null> {
  const [claimed] = await db
    .insert(phasePromptAnswers)
    .values({
      churchId: input.churchId,
      transitionId: input.transitionId,
      answeredById: input.userId,
      answer: input.answer,
    })
    .onConflictDoNothing({ target: phasePromptAnswers.transitionId })
    .returning({ id: phasePromptAnswers.id });

  return claimed?.id ?? null;
}

/**
 * Give the claim back, but ONLY when the import it was covering wrote nothing.
 *
 * A claim that failed before its first task should not cost the planter their
 * prompt — the honest state is "unanswered", and the next render asks again. A
 * claim whose import got part-way is KEPT: releasing it would re-offer
 * checklists that are already in the list, and the planter would import them
 * twice. The rest of that partial set stays reachable at `/tasks/templates`.
 */
async function releasePhaseTemplatePromptAnswer(
  answerId: string
): Promise<void> {
  await db
    .delete(phasePromptAnswers)
    .where(eq(phasePromptAnswers.id, answerId));
}

// ----------------------------------------------------------------------------
// Declining
// ----------------------------------------------------------------------------

/**
 * Decline the prompt for the plant's current transition, durably.
 *
 * Returns the transition id that was answered (whether this call recorded the
 * answer or found one already there), or `null` when there is no transition to
 * answer. A decline that loses the race is still a decline — the prompt is down
 * either way — so the two are not distinguished.
 */
export async function declinePhaseTemplatePrompt(input: {
  churchId: string;
  userId: string;
}): Promise<string | null> {
  const transition = await getLatestPhaseTransition(input.churchId);
  if (!transition) return null;

  if (!transition.answeredAt) {
    await claimPhaseTemplatePromptAnswer({
      churchId: input.churchId,
      transitionId: transition.id,
      userId: input.userId,
      answer: "declined",
    });
  }

  return transition.id;
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
 * IDEMPOTENT PER TRANSITION, AND THE DATABASE IS WHAT MAKES IT SO (ruled
 * 2026-08-10). The answer row is CLAIMED before a single task is written, with
 * `ON CONFLICT DO NOTHING` against the unique index on `transition_id`; the
 * import runs only if that claim returned a row. So a second press — a second
 * device, a cleared cookie, a double-click, or two tabs in the same
 * millisecond — reports `already_answered` and writes nothing. A read in front
 * of the import would not do it: both racers pass it, which is the shape
 * `memory/invariants.md` → Transactions names as *not* a concurrency guard.
 *
 * THE ANSWER IS PER TRANSITION, NOT PER CHECKLIST. A planter who ticks two of
 * three checklists answers the whole transition: the claim is keyed by
 * `transition_id` alone, so the third is not offered here again, and the only
 * way back to it is `/tasks/templates`. Per-checklist answers were not chosen —
 * they would need a row per offer and would leave a prompt half-alive, still on
 * screen after it had been answered. Because the cost of unticking is therefore
 * real and invisible from the button, the prompt copy states it out loud
 * (`phase-template-prompt.tsx` → `UNTICK_NOTE`, ruled 2026-08-10 round 2).
 *
 * Returns `null` when there is nothing to accept — no live prompt, or no
 * requested key survived the filter. The caller treats `null` as "leave the
 * prompt up": nothing was created and nothing has been answered.
 */
export async function acceptPhaseTemplatePrompt(
  input: AcceptPhaseTemplatePromptInput
): Promise<AcceptPhaseTemplatePromptResult | null> {
  const transition = await getLatestPhaseTransition(input.churchId);
  if (!transition) return null;

  // Answered on some other device, or a moment ago in this one. The prompt is
  // finished; it just has nothing left to create.
  if (transition.answeredAt) {
    return { status: "already_answered", transitionId: transition.id };
  }

  const prompt = buildPhaseTemplatePrompt(transition, null);
  if (!prompt) return null;

  const requested = new Set(input.templateKeys);
  // Offer order, not request order: `importTaskTemplate` stamps `created_at`
  // per row, and the sets should land in the order the planter saw them.
  const keys = prompt.offers
    .map((offer) => offer.key)
    .filter((key) => requested.has(key));

  // Nothing survived the filter, so nothing is being answered — do NOT claim.
  // A forged key list must not be able to burn the planter's real prompt.
  if (keys.length === 0) return null;

  const claimId = await claimPhaseTemplatePromptAnswer({
    churchId: input.churchId,
    transitionId: transition.id,
    userId: input.userId,
    answer: "accepted",
  });

  // The database refused the second answer. This is the whole ruling.
  if (!claimId) {
    return { status: "already_answered", transitionId: transition.id };
  }

  let createdCount = 0;
  const templateNames: string[] = [];
  let importedOn = "";

  try {
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
  } catch (error) {
    // Claimed but wrote nothing: hand the prompt back rather than leaving the
    // planter answered with an empty list. Once ANY task exists the claim is
    // kept — see `releasePhaseTemplatePromptAnswer`.
    if (createdCount === 0) {
      await releasePhaseTemplatePromptAnswer(claimId);
    }
    throw error;
  }

  return {
    status: "imported",
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
