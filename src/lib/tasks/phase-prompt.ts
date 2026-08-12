import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { phasePromptAnswers, phaseTransitions } from "@/db/schema";
import type { PhaseTransitionKind } from "@/db/schema/phase-engine";
import type { PhasePromptAnswerKind } from "@/db/schema/tasks";
import { PHASES, type PhaseNumber } from "@/lib/constants";
import type { PhaseChangedEvent } from "@/lib/phase-engine/events";

import { importTaskTemplate, planTemplateImport } from "./import";
import { phaseTemplatesFor, taskTemplateSize } from "./templates";

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
// transition, unique on `transition_id` (migration 0037). That is what makes
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
 * WHERE A PART-WAY IMPORT'S RECEIPT LIVES BETWEEN THE PRESS AND THE RE-RENDER
 * (ruled 2026-08-12, round 3 on PR #393; re-fixed after the G3 rejection).
 *
 * The receipt cannot be state in the prompt's client island, and that was the
 * shipped bug. A part-way import KEEPS its claim, so the transition is answered
 * — and per
 * `.next-docs/01-app/03-api-reference/04-functions/cookies.mdx`, "after you set
 * or delete a cookie in a Server Action, Next.js re-renders the current page and
 * its layouts on the server". The action sets the answered-cookie, so `/tasks`
 * re-renders whatever any revalidation directive says, `getPhaseTemplatePrompt`
 * returns `null`, and the island holding the receipt is removed from the tree
 * with the prompt around it. Sixteen of twenty-two tasks were created and the
 * planter was told nothing.
 *
 * So the receipt is handed to the SERVER render that follows the press, in the
 * only channel that survives it. It is a FLASH: `maxAge` is minutes, not a
 * year, and the browser clears it as soon as the receipt has been shown
 * (`ClearReceiptCookie`). It is read by exactly one surface and is not
 * `httpOnly`, because that clearing is a `document.cookie` write — forging it
 * shows its owner a message about an import that did not happen, which is the
 * whole blast radius.
 */
export const PHASE_TEMPLATE_RECEIPT_COOKIE = "ef_phase_template_receipt";

/** Long enough to survive the re-render, a reload and a second look; short
 *  enough that it cannot follow the planter into a later visit. The browser
 *  normally deletes it first — this is the no-JavaScript backstop. */
export const PHASE_TEMPLATE_RECEIPT_COOKIE_MAX_AGE = 60 * 2;

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

/**
 * What one `/tasks` render needs to know about the plant's latest stage change:
 * the prompt to ask, and the id of the transition it is reporting on.
 *
 * BOTH COME OUT OF ONE QUERY, and the id is here because the loader needs it
 * even when there is no prompt. A part-way import answers its transition, so
 * the render that owes the planter a receipt is exactly the render with no
 * prompt in it — and that receipt may only be drawn for THIS transition
 * (`receiptForTransition`). Reading the id separately would let the plant move
 * in between and pair a receipt with the wrong stage change, which is the same
 * trap `getLatestPhaseTransition` avoids by joining the answer rather than
 * fetching it.
 */
export interface PhaseTemplatePromptRead {
  /** The plant's current latest MOVE, or `null` if it has never moved. */
  transitionId: string | null;
  prompt: PhaseTemplatePrompt | null;
}

/** The one composition of "read the transition, build the prompt". */
export async function readPhaseTemplatePrompt(
  churchId: string,
  answeredTransitionId: string | null
): Promise<PhaseTemplatePromptRead> {
  const transition = await getLatestPhaseTransition(churchId);

  return {
    transitionId: transition?.id ?? null,
    prompt: buildPhaseTemplatePrompt(transition, answeredTransitionId),
  };
}

/** The prompt for a church, or `null` when there is nothing to prompt. */
export async function getPhaseTemplatePrompt(
  churchId: string,
  answeredTransitionId: string | null
): Promise<PhaseTemplatePrompt | null> {
  const { prompt } = await readPhaseTemplatePrompt(
    churchId,
    answeredTransitionId
  );
  return prompt;
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
 *
 * `partial` is a FAILURE THAT IS ALSO AN ANSWER, and it is returned rather than
 * thrown on purpose (ruled 2026-08-12, round 3 on PR #393). Once any task
 * exists the claim is kept — re-offering a checklist already in the list is how
 * a planter imports it twice — so the transition is answered and the prompt
 * will not render again. Thrown, that case is indistinguishable at the call
 * site from a total failure, and the caller would tell the planter nothing was
 * created when half a set was. `createdCount` and `templateNames` cover what
 * DID land; the remainder stays reachable at `/tasks/templates`.
 */
export type AcceptPhaseTemplatePromptResult =
  | {
      status: "imported" | "partial";
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
 * answer or found one already there), or `null` when there is nothing this call
 * may answer. A decline that loses the race is still a decline — the prompt is
 * down either way — so those two are not distinguished.
 *
 * A STALE PRESS ANSWERS NOTHING (#313). `expectedTransitionId` is the id the
 * PANEL was showing, and it is REQUIRED: it must equal the plant's current
 * transition or this call writes no row and returns `null`. Without that guard
 * a prompt left open while the plant moved on — another member advanced it, the
 * phase engine did, an oversight action did — declined the transition the
 * planter never saw, for the WHOLE PLANT and permanently: the answer is keyed by
 * transition alone and there is no un-answer path (`memory/invariants.md` →
 * Tasks). Accept was never exposed this way; it re-filters the posted keys
 * against a freshly derived prompt, so a stale key list collapses to nothing.
 *
 * The id is a GUARD, never an aim. It can only ever match the row this function
 * would have chosen anyway, so a forged value buys a no-op and nothing else —
 * which is why passing it does not weaken "the request cannot choose which
 * transition is declined". There is no opt-out: a caller with no id has no
 * rendered prompt behind it, and therefore nothing it is entitled to decline.
 */
export async function declinePhaseTemplatePrompt(input: {
  churchId: string;
  userId: string;
  /** The transition the prompt being answered was rendered for. A mismatch is
   *  refused rather than redirected. */
  expectedTransitionId: string;
}): Promise<string | null> {
  const transition = await getLatestPhaseTransition(input.churchId);
  if (!transition) return null;

  if (input.expectedTransitionId !== transition.id) return null;

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
 * A PART-WAY IMPORT IS REPORTED, NOT THROWN (ruled 2026-08-12, round 3). The
 * claim is kept once any task exists, so the prompt is spent; `partial` is what
 * lets the caller say so. Only a claim that wrote NOTHING is released, and that
 * one still throws — the prompt returns, and the caller reports a clean
 * failure.
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
    // planter answered with an empty list, and let the failure reach the caller
    // so it can say "nothing was created".
    if (createdCount === 0) {
      await releasePhaseTemplatePromptAnswer(claimId);
      throw error;
    }

    // Part-way. The claim is KEPT — see `releasePhaseTemplatePromptAnswer` —
    // so the prompt is answered and this return is the ONLY chance to tell the
    // planter that half a set arrived. Logged as well as returned: the caller
    // gets the shape, the operator gets the cause.
    console.error("acceptPhaseTemplatePrompt partial import:", error);

    return {
      status: "partial",
      transitionId: transition.id,
      importedOn,
      createdCount,
      templateNames,
    };
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
// What the caller does with the result
// ----------------------------------------------------------------------------

/**
 * What answering the prompt with Import did, in the words the island renders.
 *
 * Lives here rather than in the client island because it is the DOMAIN outcome
 * of `acceptPhaseTemplatePrompt` — the island only draws it, and the pure
 * mapper below is what decides it. The island imports it with `import type`, so
 * nothing in this module reaches a browser bundle (the same shape
 * `bulk-actions.tsx` uses for `BulkTaskResult`).
 *
 * THESE ARE THE OUTCOMES THAT LEAVE THE PROMPT ON SCREEN, and that is why there
 * is no `partial` among them. Every status here is rendered by the island,
 * which only exists for as long as the prompt does: `failed` and `nothing` both
 * leave the transition unanswered, so the next server render still contains the
 * panel and the island keeps its state through it. A part-way import answers
 * the transition, so the panel is gone by the time anything could be drawn from
 * this value — its receipt travels a different road (`PhaseTemplateImportDecision`
 * → `receipt`).
 *
 * `nothing` is "no checklist on offer was ticked", which the disabled button
 * makes unreachable from the UI but not from a forged POST or a stage change
 * that moved under the planter's feet.
 */
export type PhaseTemplateImportOutcome =
  | { status: "idle" }
  | { status: "nothing" }
  | { status: "failed" };

/** Declining creates nothing, so it either landed or it did not. */
export type PhaseTemplateDismissOutcome =
  | { status: "idle" }
  | { status: "failed" };

/**
 * What a part-way import left behind: the two facts the receipt states.
 *
 * It is carried to the next SERVER render in a flash cookie
 * (`PHASE_TEMPLATE_RECEIPT_COOKIE`), so it must round-trip through a string a
 * browser can hold, forge or corrupt — hence the codec below rather than
 * `JSON.parse` at the call site.
 */
export interface PhaseTemplatePartialReceipt {
  /**
   * WHICH stage change this receipt reports on — and the reason it is here.
   *
   * A receipt is only true about the transition that minted it, and the cookie
   * can outlive that transition: a live prompt WINS over a lingering receipt
   * (the loader's rule), so a plant that moves stage again inside the two
   * minutes puts a new prompt on screen, the receipt branch is skipped, and the
   * flash is never spent by `ClearReceiptCookie`. Answer that new prompt — a
   * clean, complete import — and the render after it has no prompt again,
   * reaches the surviving cookie and says "the remaining checklists were not
   * created" about a press where everything was.
   *
   * The cookie cannot be cleared from a render (`cookies().set` is a Server
   * Action / Route Handler call only), so the identity travels IN the value and
   * the loader refuses to draw a receipt belonging to any other transition. A
   * superseded receipt renders nothing and expires on its own `maxAge`.
   */
  transitionId: string;
  createdCount: number;
  templateNames: string[];
}

/** Enough names for the biggest phase in the catalog, and a cap so a cookie
 *  cannot grow without bound. Both halves are enforced on the way out AND on
 *  the way in — the value that comes back is a browser's, not ours. */
const RECEIPT_MAX_NAMES = 8;
const RECEIPT_MAX_NAME_LENGTH = 120;

/** A transition id is a uuid (36). Bounded rather than truncated: a clipped id
 *  matches nothing anyway, so the honest answer to an oversized one is "not a
 *  receipt". */
const RECEIPT_MAX_ID_LENGTH = 64;

/** The receipt as a cookie value. `encodeURIComponent` because template names
 *  are prose — commas, semicolons and spaces are all legal in them and none of
 *  them are legal, unquoted, in a cookie. */
export function encodePartialImportReceipt(
  receipt: PhaseTemplatePartialReceipt
): string {
  return encodeURIComponent(
    JSON.stringify({
      transitionId: receipt.transitionId,
      createdCount: receipt.createdCount,
      templateNames: receipt.templateNames
        .slice(0, RECEIPT_MAX_NAMES)
        .map((name) => name.slice(0, RECEIPT_MAX_NAME_LENGTH)),
    })
  );
}

/**
 * The receipt back out of a cookie, or `null` — and NEVER a throw.
 *
 * This runs inside the `/tasks` render, where the value is whatever the browser
 * sent: absent, truncated, half-URL-decoded by a proxy, or hand-written. There
 * is no error boundary on that route (see the header of
 * `src/db/migrations/0037_phase_prompt_answers.sql`), so a parse error here is a
 * 500 on the task list. Every branch that is not a well-formed receipt returns
 * `null`, which renders nothing at all.
 *
 * A forged value buys its author a sentence about an import that did not
 * happen, in their own browser. Nothing is read from it but a count and some
 * names, both re-clamped here.
 */
export function decodePartialImportReceipt(
  raw: string | null | undefined
): PhaseTemplatePartialReceipt | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const { transitionId, createdCount, templateNames } = parsed as {
    transitionId?: unknown;
    createdCount?: unknown;
    templateNames?: unknown;
  };

  // No transition, no receipt. A value that cannot say WHICH stage change it
  // reports on can never be matched against the render's own transition, so it
  // would be exactly the unspendable, always-drawable flash this field exists
  // to stop — including every receipt minted before this field did.
  if (
    typeof transitionId !== "string" ||
    transitionId.length === 0 ||
    transitionId.length > RECEIPT_MAX_ID_LENGTH
  ) {
    return null;
  }

  // A partial import created at least one task, by definition — anything else
  // is a corrupted or forged value and has no sentence to render.
  if (
    typeof createdCount !== "number" ||
    !Number.isSafeInteger(createdCount) ||
    createdCount <= 0
  ) {
    return null;
  }

  if (!Array.isArray(templateNames)) return null;
  if (!templateNames.every((name) => typeof name === "string")) return null;

  return {
    transitionId,
    createdCount,
    templateNames: templateNames
      .slice(0, RECEIPT_MAX_NAMES)
      .map((name) => name.slice(0, RECEIPT_MAX_NAME_LENGTH)),
  };
}

/**
 * The receipt this render is allowed to draw, or `null`.
 *
 * ONE FUNCTION, BECAUSE THE DECODE ALONE IS NOT THE QUESTION. "Is this a
 * well-formed receipt?" and "is it about the transition I am reporting on?" are
 * both required, and a call site that asks only the first draws a stale alarm:
 * a receipt minted for transition A, superseded by a stage change to B before
 * it could be drawn, then met by the render that follows a clean answer to B —
 * `role="alert"`, destructive, and false in every clause. The flash cannot be
 * cleared from a render, so refusing it is the whole defence.
 *
 * `transitionId` is the plant's CURRENT latest transition (`null` when it has
 * none, which no receipt can match). Never throws, for the same reason
 * `decodePartialImportReceipt` does not.
 */
export function receiptForTransition(
  raw: string | null | undefined,
  transitionId: string | null
): PhaseTemplatePartialReceipt | null {
  if (!transitionId) return null;

  const receipt = decodePartialImportReceipt(raw);
  if (!receipt) return null;

  return receipt.transitionId === transitionId ? receipt : null;
}

export interface PhaseTemplateImportDecision {
  outcome: PhaseTemplateImportOutcome;
  /**
   * What the NEXT server render must say, or `null` when it has nothing to say.
   *
   * Only a part-way import fills this in, and the reason it is a separate field
   * rather than a status the island renders is the G3 rejection of 2026-08-12:
   * the island is unmounted by the re-render that the answer itself causes, so
   * an outcome is the one place this cannot be kept. The caller writes it to the
   * flash cookie and the server component draws it.
   */
  receipt: PhaseTemplatePartialReceipt | null;
  /**
   * The transition to write the cookie fast path against, or `null` when
   * nothing was answered and the prompt must stay up.
   *
   * It doubles as "something changed": an answered transition is exactly the
   * case where `/tasks` has to be re-read — the prompt comes down and the list
   * gained tasks — so the caller's `refresh()` hangs off this and no separate
   * revalidation directive exists. There WAS one, `PhasePromptRevalidation`,
   * built to let the partial case re-read nothing so its receipt would survive.
   * It could not work: setting a cookie re-renders the route by itself
   * (`.next-docs/01-app/03-api-reference/04-functions/cookies.mdx`), and the
   * answer always sets one.
   */
  answeredTransitionId: string | null;
}

/**
 * Every decision the Import press makes, as a pure function of what the service
 * returned.
 *
 * Extracted from the inline server action because that action cannot be called
 * from a test — it is a non-exported `"use server"` closure — and the round-3
 * ruling lives entirely in these four branches. Here the whole set is
 * assertable, including the one that has no visible symptom until a browser is
 * open: the partial case must hand its receipt to the next SERVER render.
 *
 * `null` in means "nothing was answered": no live prompt, an empty tick list, or
 * every key forged. The prompt stays up and says so.
 */
export function decidePhaseTemplateImportOutcome(
  result: AcceptPhaseTemplatePromptResult | null
): PhaseTemplateImportDecision {
  if (!result) {
    return {
      outcome: { status: "nothing" },
      receipt: null,
      answeredTransitionId: null,
    };
  }

  // A part-way import ANSWERS the transition, so the prompt — and the island
  // inside it — is gone from the next render of `/tasks`. The outcome it hands
  // back is therefore never drawn; the receipt is, by the server.
  if (result.status === "partial") {
    return {
      outcome: { status: "idle" },
      receipt: {
        // The receipt is only true about THIS transition, and the cookie can
        // outlive it — a stage change inside the flash window puts a live
        // prompt up, which wins, so the flash is never spent. The id is what
        // lets the next render tell "my receipt" from "somebody else's".
        transitionId: result.transitionId,
        createdCount: result.createdCount,
        templateNames: result.templateNames,
      },
      answeredTransitionId: result.transitionId,
    };
  }

  // `imported` and `already_answered` both mean the transition is answered and
  // the prompt must come down; the second simply created nothing this time.
  return {
    outcome: { status: "idle" },
    receipt: null,
    answeredTransitionId: result.transitionId,
  };
}

export interface PhaseTemplateDismissDecision {
  outcome: PhaseTemplateDismissOutcome;
  answeredTransitionId: string | null;
}

/**
 * The same seam for "Not now", from what `declinePhaseTemplatePrompt` returned.
 *
 * `null` means there was no transition to decline, so the press changed nothing
 * — reported as a failure, because from the planter's side a press that changed
 * nothing IS one. A decline that landed takes the prompt down, so the route is
 * re-read.
 */
export function decidePhaseTemplateDismissOutcome(
  transitionId: string | null
): PhaseTemplateDismissDecision {
  if (!transitionId) {
    return {
      outcome: { status: "failed" },
      answeredTransitionId: null,
    };
  }

  return {
    outcome: { status: "idle" },
    answeredTransitionId: transitionId,
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
