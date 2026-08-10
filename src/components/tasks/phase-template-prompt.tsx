import { refresh, revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { Button } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/datetime";
import {
  PHASE_TEMPLATE_PROMPT_COOKIE,
  PHASE_TEMPLATE_PROMPT_COOKIE_MAX_AGE,
  acceptPhaseTemplatePrompt,
  getLatestPhaseTransition,
  getPhaseTemplatePrompt,
  type PhaseTemplateOffer,
  type PhaseTemplatePrompt as PhaseTemplatePromptData,
} from "@/lib/tasks/phase-prompt";

// ============================================================================
// T-020 — the prompt itself.
//
// A SERVER COMPONENT WITH A PLAIN FORM, and no client bundle at all. What the
// planter does here is tick boxes and press one of two buttons, which is what
// a form is; making it a client island would buy an optimistic update for a
// component whose whole job is to disappear once it is answered. It also keeps
// the auth surface honest: the two actions below are the ONLY exports-shaped
// things in this file that a browser can POST to, they capture nothing, and
// each mints its own actor from the session (`memory/invariants.md` →
// Authentication).
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
// ============================================================================

const PROMPT_HEADING_ID = "phase-template-prompt-heading";

/** Said where the press happens: this creates work, and only what is ticked. */
const PROMPT_NOTE =
  "Nothing is created until you press Import. Untick anything you do not want.";

/**
 * What "Not now" costs, stated before it is pressed.
 *
 * It names no second route to the catalog because it does not have to: this
 * prompt only ever renders on `/tasks`, whose header carries the "Checklist
 * templates" link to `/tasks/templates` a few pixels above it. Repeating the
 * destination here would be the same door labelled twice on one screen.
 */
const DISMISS_NOTE =
  "Not now creates nothing and hides this until your next stage change.";

// ----------------------------------------------------------------------------
// Answering
// ----------------------------------------------------------------------------

/**
 * Record that THIS transition's prompt has been answered.
 *
 * A cookie, holding the transition id — see `phase-prompt.ts` for why there is
 * no table behind this. It is `httpOnly` because nothing in the browser needs
 * to read it, and forging it costs its owner nothing but their own prompt.
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
 * A failure leaves the prompt exactly where it was: the answer is only
 * recorded once the tasks exist, so "still there" is the signal that nothing
 * happened, and pressing again is safe.
 */
async function importPhaseTemplatesAction(formData: FormData): Promise<void> {
  "use server";

  try {
    const { user } = await getCurrentSession();
    if (!user?.churchId) return;

    const templateKeys = formData
      .getAll("templateKey")
      .filter((value): value is string => typeof value === "string");

    if (templateKeys.length === 0) return;

    const result = await acceptPhaseTemplatePrompt({
      churchId: user.churchId,
      userId: user.id,
      templateKeys,
    });

    // `null` means nothing was created — no live prompt, or every key was
    // forged. Nothing to answer, so the prompt stays up.
    if (!result) return;

    await markPromptAnswered(result.transitionId);

    // The list this sits above is on the same page, so `refresh()` reconciles
    // it; `revalidatePath` covers the same page reached from elsewhere
    // (`memory/contracts/data-patterns.md`).
    refresh();
    revalidatePath("/tasks");
  } catch (error) {
    console.error("importPhaseTemplatesAction error:", error);
  }
}

/**
 * Decline: record the answer and create nothing.
 *
 * Takes NO input at all. The transition being declined is re-read from the
 * database, so the request cannot aim the dismissal at a transition other than
 * the plant's current one.
 */
async function dismissPhaseTemplatePromptAction(): Promise<void> {
  "use server";

  try {
    const { user } = await getCurrentSession();
    if (!user?.churchId) return;

    const transition = await getLatestPhaseTransition(user.churchId);
    if (!transition) return;

    await markPromptAnswered(transition.id);

    refresh();
    revalidatePath("/tasks");
  } catch (error) {
    console.error("dismissPhaseTemplatePromptAction error:", error);
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
  importAction: (formData: FormData) => void | Promise<void>;
  dismissAction: () => void | Promise<void>;
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
      <div className="space-y-1">
        <h2 id={PROMPT_HEADING_ID} className="text-base font-medium">
          You moved to {prompt.phaseName}
        </h2>
        <p className="text-muted-foreground text-sm">
          {prompt.offers.length === 1
            ? "There is a ready-made checklist for this stage"
            : `There are ${prompt.offers.length} ready-made checklists for this stage`}
          {" — "}
          {taskCountLabel(prompt.totalTaskCount)} in all, dated from the day you
          moved ({formatDate(prompt.transitionedAt, "short")}).
        </p>
        <p className="text-muted-foreground text-sm">{PROMPT_NOTE}</p>
      </div>

      <form action={importAction} className="space-y-4">
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

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" className="cursor-pointer">
            Import checklists
          </Button>
          {/*
            A second action on the same form rather than a nested one — a form
            may not contain a form, and the two answers belong to one control
            group. `formAction` is how React routes a submit to the other
            server function.
          */}
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            formAction={dismissAction}
            className="cursor-pointer"
          >
            Not now
          </Button>
        </div>

        <p className="text-muted-foreground text-xs">{DISMISS_NOTE}</p>
      </form>
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
