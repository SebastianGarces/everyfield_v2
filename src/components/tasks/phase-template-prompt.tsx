import { refresh, revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";

import { PhaseTemplatePromptForm } from "@/components/tasks/phase-template-prompt-controls";
import { getCurrentSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/datetime";
import {
  PHASE_TEMPLATE_PROMPT_COOKIE,
  PHASE_TEMPLATE_PROMPT_COOKIE_MAX_AGE,
  acceptPhaseTemplatePrompt,
  decidePhaseTemplateDismissOutcome,
  decidePhaseTemplateImportOutcome,
  declinePhaseTemplatePrompt,
  getPhaseTemplatePrompt,
  type PhaseTemplateDismissOutcome,
  type PhaseTemplateImportOutcome,
  type PhaseTemplateOffer,
  type PhasePromptRevalidation,
  type PhaseTemplatePrompt as PhaseTemplatePromptData,
} from "@/lib/tasks/phase-prompt";
import { TEMPLATES_LINK_LABEL, TEMPLATES_ROUTE } from "@/lib/tasks/templates";

// ============================================================================
// T-020 — the prompt itself.
//
// A SERVER COMPONENT, AND ALL OF ITS MARKUP IS SERVER MARKUP. What the planter
// does here is tick boxes and press one of two buttons, which is what a form
// is. The `<form>` element itself lives in the client island next door —
// `useActionState` requires it — but the lead, the checklist rows and the fine
// print are passed INTO the island as props, so they are still rendered on the
// server and no row becomes a client component. It also keeps the auth surface
// honest: the two actions below are the ONLY exports-shaped things in this file
// that a browser can POST to, they capture nothing, and each mints its own
// actor from the session (`memory/invariants.md` → Authentication).
//
// EVERY OUTCOME IS SAID OUT LOUD (ruled 2026-08-12, round 3 on PR #393). Both
// actions used to return `void` and log their failures to the console. A press
// that writes 22–26 tasks may not fail silently, and the PARTIAL import is the
// case that has no second chance: the claim is kept by design, so the prompt is
// answered and never renders again. Each action therefore returns an outcome
// and the island renders it.
//
// TICKED BY DEFAULT, WHICH IS NOT THE SAME AS AUTOMATIC. The FRD's sketch
// offers "Yes, import all" / "Let me choose" / "Skip"; one ticked list with an
// Import and a Not-now button is all three, without a second screen. Nothing
// is created until a button is pressed — the ticks are a preselection, not a
// decision already taken on the planter's behalf.
//
// THE DATES ARE SHOWN, NOT PROMISED. Each row states the day its last task
// falls on, computed by the same function the import runs, from the transition
// instant. A planter who moved stages a week ago can see that the checklist
// arrives already part-spent, and decline for that reason.
//
// THE ANSWER IS DURABLE NOW (ruled 2026-08-10, PR #393). Answering writes a row
// keyed by the transition id, so a decline follows the planter to their phone
// and a second accept — another device, cleared cookies, a double press — adds
// nothing. The cookie below is kept as a fast path and nothing more.
//
// THE COPY IS IN TWO REGISTERS, NOT ONE STACK OF NOTES (ruled 2026-08-10 round
// 2, PR #393). Round 2 required the prompt to say what unticking COSTS — the
// answer covers the whole transition, so an unticked checklist is not offered
// again for this stage change — and to name where it stays reachable. Said as a
// fourth muted paragraph on top of three others, that sentence would have
// landed in a wall nobody reads. So the card says the two things that change
// what the planter TICKS in the lead paragraphs, at `text-sm`, and drops the
// standing policy (what an import does, what "Not now" does) to `text-xs` fine
// print directly above the buttons. Two sizes, four sentences, one wall fewer.
// ============================================================================

const PROMPT_HEADING_ID = "phase-template-prompt-heading";

/** Said where the press happens: this creates work, and only what is ticked. */
const PROMPT_NOTE =
  "Nothing is created until you press Import. Untick anything you do not want.";

/**
 * What unticking COSTS, said next to the ticks (ruled 2026-08-10, round 2).
 *
 * The answer is one row per transition, not one per checklist: accepting two of
 * three checklists answers the transition, and the third is never offered here
 * again. Before this, "Untick anything you do not want" read as a pause — take
 * these now, that one later — and the prompt was gone by later. So the
 * consequence is stated in the same breath as the instruction, and the sentence
 * ends at the catalog link rather than at a dead end: nothing is lost, it just
 * moves to a route the planter has to walk to.
 *
 * Ends mid-sentence on purpose — the link completes it in the markup below.
 */
const UNTICK_NOTE =
  "Unticked checklists are not offered again for this stage change. You can still import them at any time from";

/**
 * The import policy, stated on the surface where the press happens.
 *
 * The catalog has said this since T-011 (`TEMPLATE_REIMPORT_NOTE`); the prompt
 * did not, and a repeat here is 22–26 tasks rather than one small checklist.
 * The wording is deliberately NOT the catalog's, because the two surfaces no
 * longer behave the same: importing from the catalog again really does add a
 * second copy, while this prompt can be answered exactly once per stage change.
 * Both halves are said, because both are surprising on their own.
 *
 * Fine print, and BELOW the checklist rather than above it: it describes what
 * the buttons do, not what to tick, and it is the sentence a planter re-reads
 * with a finger already on Import.
 */
const IMPORT_POLICY_NOTE =
  "Imported tasks are added as new tasks. Nothing is merged, replaced or skipped. You can answer this once per stage change: importing again adds nothing, on any device.";

/**
 * What "Not now" costs, stated before it is pressed.
 *
 * It names no second route to the catalog because `UNTICK_NOTE` already has,
 * two paragraphs up — and this prompt only ever renders on `/tasks`, whose
 * header carries the same "Checklist templates" link. A third label on one
 * screen is the same door signposted three times.
 */
const DISMISS_NOTE =
  "Not now creates nothing and hides this until your next stage change.";

// ----------------------------------------------------------------------------
// Answering
// ----------------------------------------------------------------------------

/**
 * Note in THIS browser that the transition has been answered.
 *
 * A fast path, not the record: `phase_prompt_answers` is written by the service
 * first and is what every device reads (`phase-prompt.ts`). The cookie can only
 * suppress a prompt the row suppresses anyway, which is why it is safe to keep
 * `httpOnly` and to leave forging it as a way to hide your own prompt.
 */
async function markPromptAnswered(transitionId: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(PHASE_TEMPLATE_PROMPT_COOKIE, transitionId, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PHASE_TEMPLATE_PROMPT_COOKIE_MAX_AGE,
  });
}

/**
 * Carry out a revalidation directive. Both actions answer the same way, and
 * WHAT to re-read is decided in `phase-prompt.ts`, where it can be tested.
 */
function applyRevalidation(revalidation: PhasePromptRevalidation): void {
  if (revalidation.refresh) refresh();
  if (revalidation.revalidatePath) revalidatePath("/tasks");
}

/**
 * Accept: import the ticked checklists, dated from the transition.
 *
 * Defined at module scope on purpose. An action closing over the session would
 * be an actor supplied by the request, which is the shape
 * `memory/invariants.md` → Authentication forbids; this one captures nothing
 * and mints its actor itself. The church is implied by the actor and the
 * transition is implied by the church, so the ONLY thing the form supplies is
 * which checklists were ticked — and `acceptPhaseTemplatePrompt` filters even
 * that against what is genuinely on offer.
 *
 * Pressing again is safe, and the database is what makes it so: the answer row
 * is claimed before the first task is written, so a repeat — a second device, a
 * cleared cookie, a double press — imports nothing and reports
 * `already_answered`. Both outcomes take the prompt down, because both mean the
 * transition has been answered.
 *
 * SHAPED FOR `useActionState`: `(previous outcome, form) → next outcome`. The
 * previous outcome is never read — an answer is decided by the database and the
 * form, not by what the last press reported.
 *
 * WHAT TO REPORT AND WHAT TO RE-READ IS NOT DECIDED HERE. This body reads the
 * session, reads the form and performs the effects; the branching lives in
 * `decidePhaseTemplateImportOutcome`, which is pure and exported so all four
 * service results can be asserted. A `"use server"` closure cannot be called
 * from a test, and the round-3 rulings were hiding inside one.
 */
async function importPhaseTemplatesAction(
  _previous: PhaseTemplateImportOutcome,
  formData: FormData
): Promise<PhaseTemplateImportOutcome> {
  "use server";

  try {
    const { user } = await getCurrentSession();
    if (!user?.churchId) return { status: "failed" };

    const templateKeys = formData
      .getAll("templateKey")
      .filter((value): value is string => typeof value === "string");

    // An empty tick list is unreachable from the buttons — Import refuses it —
    // so this is a forged POST or a browser with no JavaScript. It must not
    // reach the service, because `acceptPhaseTemplatePrompt` would have nothing
    // to filter; `null` is the same "nothing was answered" the service reports.
    const result =
      templateKeys.length === 0
        ? null
        : await acceptPhaseTemplatePrompt({
            churchId: user.churchId,
            userId: user.id,
            templateKeys,
          });

    const decision = decidePhaseTemplateImportOutcome(result);

    if (decision.answeredTransitionId) {
      await markPromptAnswered(decision.answeredTransitionId);
    }
    applyRevalidation(decision.revalidation);

    return decision.outcome;
  } catch (error) {
    console.error("importPhaseTemplatesAction error:", error);
    return { status: "failed" };
  }
}

/**
 * Decline: record the answer and create nothing.
 *
 * Reads NOTHING from the form. The transition being declined is re-read from
 * the database, so the request cannot aim the dismissal at a transition other
 * than the plant's current one. `useActionState` hands its action the previous
 * outcome and then a `FormData`; this signature accepts neither past the first,
 * which is the clearest way to say nothing in the form is read.
 *
 * The decline is written to `phase_prompt_answers`, so it holds on every
 * device — the cookie afterwards only saves this browser the join.
 *
 * `null` from the service means there is no transition to decline, which leaves
 * the prompt exactly as it was. Reported as a failure, because from the
 * planter's side a press that changed nothing IS one.
 */
async function dismissPhaseTemplatePromptAction(
  _previous: PhaseTemplateDismissOutcome
): Promise<PhaseTemplateDismissOutcome> {
  "use server";

  try {
    const { user } = await getCurrentSession();
    if (!user?.churchId) return { status: "failed" };

    const transitionId = await declinePhaseTemplatePrompt({
      churchId: user.churchId,
      userId: user.id,
    });

    const decision = decidePhaseTemplateDismissOutcome(transitionId);

    if (decision.answeredTransitionId) {
      await markPromptAnswered(decision.answeredTransitionId);
    }
    applyRevalidation(decision.revalidation);

    return decision.outcome;
  } catch (error) {
    console.error("dismissPhaseTemplatePromptAction error:", error);
    return { status: "failed" };
  }
}

// ----------------------------------------------------------------------------
// Copy helpers
// ----------------------------------------------------------------------------

function taskCountLabel(count: number): string {
  return count === 1 ? "1 task" : `${count} tasks`;
}

/** `"Aug 24, 2026"`, pinned to `APP_TIME_ZONE` — a due date is a calendar day,
 *  and formatting one in the runtime's zone is how SSR and hydration disagree
 *  (`memory/invariants.md` → Date & Time Rendering). */
function formatDueDate(day: string): string {
  return formatDate(new Date(`${day}T00:00:00Z`), "short");
}

/** What one checklist would put on the calendar, in one sentence. */
function offerSpan(offer: PhaseTemplateOffer): string {
  if (offer.firstDueDate === offer.lastDueDate) {
    return `${taskCountLabel(offer.taskCount)}, all due ${formatDueDate(offer.lastDueDate)}.`;
  }

  return `${taskCountLabel(offer.taskCount)}, due between ${formatDueDate(offer.firstDueDate)} and ${formatDueDate(offer.lastDueDate)}.`;
}

// ----------------------------------------------------------------------------
// The view
// ----------------------------------------------------------------------------

export interface PhaseTemplatePromptViewProps {
  prompt: PhaseTemplatePromptData;
  importAction: (
    state: PhaseTemplateImportOutcome,
    formData: FormData
  ) => Promise<PhaseTemplateImportOutcome>;
  dismissAction: (
    state: PhaseTemplateDismissOutcome
  ) => Promise<PhaseTemplateDismissOutcome>;
}

/**
 * The markup, with the reads and the actions handed in.
 *
 * Split from the loader below so the prompt can be rendered — and its controls
 * asserted — without a session, a database or a phase transition.
 */
export function PhaseTemplatePromptView({
  prompt,
  importAction,
  dismissAction,
}: PhaseTemplatePromptViewProps) {
  return (
    <section
      aria-labelledby={PROMPT_HEADING_ID}
      data-testid="phase-template-prompt"
      className="border-border bg-card space-y-4 rounded-md border p-4 shadow-sm"
    >
      <PhaseTemplatePromptForm
        offerCount={prompt.offers.length}
        importAction={importAction}
        dismissAction={dismissAction}
        lead={
          /*
            `data-testid` is a TEST SEAM, not styling. The structural tests
            assert that the lead stays two paragraphs and that both standing
            notes sit in the fine print — a rule about WHICH BLOCK a sentence
            lives in. Anchored to the serialized class string, those tests broke
            on a prettier class reorder; anchored here, they break only when a
            note actually moves.

            Handed to the island rather than rendered beside it so a partial
            import can replace the whole body with its receipt: the lead offers
            checklists that, by then, have been answered for.
          */
          <div data-testid="prompt-lead" className="space-y-1">
            <h2 id={PROMPT_HEADING_ID} className="text-base font-medium">
              You moved to {prompt.phaseName}
            </h2>
            <p className="text-muted-foreground text-sm">
              {prompt.offers.length === 1
                ? "There is a ready-made checklist for this stage"
                : `There are ${prompt.offers.length} ready-made checklists for this stage`}
              {" — "}
              {taskCountLabel(prompt.totalTaskCount)} in all, dated from the day
              you moved ({formatDate(prompt.transitionedAt, "short")}).
            </p>
            <p className="text-muted-foreground text-sm">
              {PROMPT_NOTE} {UNTICK_NOTE}{" "}
              <Link
                href={TEMPLATES_ROUTE}
                className="text-primary cursor-pointer font-medium underline underline-offset-4"
              >
                {TEMPLATES_LINK_LABEL}
              </Link>
              .
            </p>
          </div>
        }
      >
        <ul className="divide-border border-border divide-y rounded-md border">
          {prompt.offers.map((offer) => {
            const inputId = `phase-template-${offer.key}`;

            return (
              <li key={offer.key} className="p-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id={inputId}
                    name="templateKey"
                    value={offer.key}
                    defaultChecked
                    className="border-input accent-primary mt-1 h-4 w-4 cursor-pointer rounded-sm"
                  />
                  <div className="space-y-1">
                    <label
                      htmlFor={inputId}
                      className="cursor-pointer text-sm font-medium"
                    >
                      {offer.name}
                    </label>
                    <p className="text-muted-foreground text-sm">
                      {offer.description}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {offerSpan(offer)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/*
          The fine print, in one block at a size the lead paragraphs do not use.
          It sits between the checklist and the buttons because both sentences
          are about what a press does — and because the alternative, stacking
          them above as a fourth and fifth muted `text-sm` line, is the wall
          round 2 of the review objected to.
        */}
        <div
          data-testid="prompt-fine-print"
          className="text-muted-foreground space-y-1 text-xs"
        >
          <p>{IMPORT_POLICY_NOTE}</p>
          <p>{DISMISS_NOTE}</p>
        </div>
      </PhaseTemplatePromptForm>
    </section>
  );
}

// ----------------------------------------------------------------------------
// The loader
// ----------------------------------------------------------------------------

/**
 * The prompt for the signed-in planter's plant, or nothing.
 *
 * Renders `null` — no wrapper, no empty state — whenever there is nothing to
 * ask about: no session, no church, no transition, an already-answered
 * transition, or a phase the catalog has no checklist for. A prompt that is
 * always present is not a prompt.
 */
export async function PhaseTemplatePrompt() {
  const { user } = await getCurrentSession();
  if (!user?.churchId) return null;

  const cookieStore = await cookies();
  const answeredTransitionId =
    cookieStore.get(PHASE_TEMPLATE_PROMPT_COOKIE)?.value ?? null;

  const prompt = await getPhaseTemplatePrompt(
    user.churchId,
    answeredTransitionId
  );
  if (!prompt) return null;

  return (
    <PhaseTemplatePromptView
      prompt={prompt}
      importAction={importPhaseTemplatesAction}
      dismissAction={dismissPhaseTemplatePromptAction}
    />
  );
}
