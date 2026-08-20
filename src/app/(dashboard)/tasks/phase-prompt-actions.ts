"use server";

// ============================================================================
// T-020 — the two endpoints behind the phase-template prompt.
//
// THEY USED TO BE INLINE `"use server"` CLOSURES inside
// `components/tasks/phase-template-prompt.tsx`, and that is why they are here
// now (#498 review). A function-level directive publishes a POST endpoint every
// bit as reachable as a module-level one, but it is invisible to the walk that
// enforces the seat guard: `guardedServerActionExports` reads the EXPORTS of
// modules whose PROLOGUE carries the directive, so two live writes — one of
// which creates 22–26 tasks — sat outside the auth surface the export-walk
// claims to cover. The old comment beside them said as much and answered "the
// rule is the authority here, not the walk", which is exactly the arrangement
// #498 exists to end. `seat-guard.test.ts` now fails on a directive found
// anywhere but a module prologue.
//
// Each is guarded by the capability its EFFECT names, not by where its button
// lives: importing checklists creates tasks (`tasks.write`), and declining the
// prompt answers a phase transition for the whole plant (`phase.signal`).
//
// A SIBLING MODULE, not `tasks/actions.ts`, because these two carry the prompt's
// own outcome types and its cookie receipt. Nothing else in the tasks surface
// speaks that vocabulary, and `tasks/actions.ts` is already the longest action
// module in the product.
// ============================================================================

import { refresh } from "next/cache";
import { cookies } from "next/headers";

import { requireSeat } from "@/lib/auth/seats";
import {
  PHASE_TEMPLATE_RECEIPT_COOKIE,
  PHASE_TEMPLATE_RECEIPT_COOKIE_MAX_AGE,
  acceptPhaseTemplatePrompt,
  decidePhaseTemplateDismissOutcome,
  decidePhaseTemplateImportOutcome,
  declinePhaseTemplatePrompt,
  encodePartialImportReceipt,
  type PhaseTemplateDismissOutcome,
  type PhaseTemplateImportOutcome,
  type PhaseTemplatePartialReceipt,
} from "@/lib/tasks/phase-prompt";

/**
 * Hand a part-way import's receipt to the render that is about to replace the
 * prompt panel.
 *
 * A COOKIE BECAUSE NOTHING ELSE SURVIVES THE PRESS. The claim is kept when an
 * import gets part-way, so the transition is answered; the next render of
 * `/tasks` has no prompt in it, and React state in the prompt's island dies
 * with the prompt. The database holds "answered", not "answered badly" — and
 * giving it a column for that would be a migration in a track whose migration
 * is already stamped and reviewed. A short-lived cookie carries the two facts
 * the planter is owed, exactly once.
 *
 * NOT `httpOnly`, deliberately: the browser deletes this cookie as soon as the
 * receipt has been shown (`ClearReceiptCookie`), which is a `document.cookie`
 * write. The value is a count and some template names, and forging it shows its
 * own author one sentence about an import that never happened.
 *
 * NOT EXPORTED. An export of this module is a POST endpoint, and a cookie
 * writer taking its value from the caller is one nobody decided the rules for.
 */
async function markPartialImportReceipt(
  receipt: PhaseTemplatePartialReceipt
): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(
    PHASE_TEMPLATE_RECEIPT_COOKIE,
    encodePartialImportReceipt(receipt),
    {
      path: "/",
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: PHASE_TEMPLATE_RECEIPT_COOKIE_MAX_AGE,
    }
  );
}

/**
 * Accept: import the ticked checklists, dated from the transition.
 *
 * It captures nothing and takes no actor — the church comes from the guard,
 * which is the shape `memory/invariants.md` → Authentication requires: an
 * action closing over a session would be an actor supplied by the request.
 *
 * THE GUARD IS ABOVE THE `try`, not merely first inside it. Inside, the catch
 * would convert a seatless or sessionless POST into a handled
 * `{ status: "failed" }`; above it the rejection escapes, which is what a
 * caller who may not do this is owed.
 *
 * SHAPED FOR `useActionState`: `(previous outcome, form) → next outcome`. The
 * previous outcome is never read — an answer is decided by the database and the
 * form, not by what the last press reported.
 *
 * WHAT TO REPORT AND WHAT TO RE-READ IS NOT DECIDED HERE. This body reads the
 * session, reads the form and performs the effects; the branching lives in
 * `decidePhaseTemplateImportOutcome`, which is pure and exported so all four
 * service results can be asserted.
 */
export async function importPhaseTemplatesAction(
  _previous: PhaseTemplateImportOutcome,
  formData: FormData
): Promise<PhaseTemplateImportOutcome> {
  const { user } = await requireSeat("tasks.write");

  try {
    // Not part of the auth check: a signed-in user with no church has no plant
    // to import INTO, which is a data condition and gets a handled outcome.
    if (!user.churchId) return { status: "failed" };

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

    // BEFORE the `refresh()` below, because that re-render is what reads it.
    // The write is also what makes the re-render unavoidable — setting a cookie
    // in a Server Action re-renders the route on its own
    // (`.next-docs/01-app/03-api-reference/04-functions/cookies.mdx`) — so the
    // receipt cannot be written by a press that has nowhere to draw it.
    if (decision.receipt) {
      await markPartialImportReceipt(decision.receipt);
    }

    if (decision.answeredTransitionId) {
      // An answered transition is exactly the case where `/tasks` changed: the
      // prompt comes down and the list gained tasks. `refresh()` and nothing
      // else — the planter is ON the affected route, which is what
      // `memory/contracts/data-patterns.md` reserves `revalidatePath` for.
      refresh();
    }

    return decision.outcome;
  } catch (error) {
    console.error("importPhaseTemplatesAction error:", error);
    return { status: "failed" };
  }
}

/**
 * Decline: record the answer and create nothing.
 *
 * `phase.signal` rather than `tasks.write`: this press creates no task. It
 * answers the plant's stage change, once and for everyone, with no un-answer
 * path — which is a phase-surface write wearing a tasks-surface button.
 *
 * IT READS ONE FIELD, AND ONLY AS A GUARD. The transition being declined is
 * still re-read from the database and the church still comes from the session,
 * so the request cannot AIM the dismissal — but the id the planter was looking
 * at has to travel with the press. Without it a panel left open while the plant
 * moved on (another member, the phase engine, an oversight action) declined the
 * NEW stage change, permanently and for the whole plant, with no un-answer path
 * (`memory/invariants.md` → Tasks: the answer belongs to the PLANT). The posted
 * id must EQUAL the server's own latest transition, so the only outcome a
 * forged or stale value can force is a no-op, which is reported as a failure
 * and leaves the real, current prompt on the next render.
 *
 * The decline is written to `phase_prompt_answers`, so it holds on every
 * device — the cookie afterwards only saves this browser the join, and only a
 * press that WROTE that row is allowed to mint it.
 *
 * `null` from the service means there is no transition to decline, or the one
 * named is no longer current. Either way the press changed nothing, and from
 * the planter's side a press that changed nothing IS a failure.
 */
export async function dismissPhaseTemplatePromptAction(
  _previous: PhaseTemplateDismissOutcome,
  formData: FormData
): Promise<PhaseTemplateDismissOutcome> {
  const { user } = await requireSeat("phase.signal");

  try {
    // Not part of the auth check: a signed-in user with no church has no plant
    // whose prompt this could be, which is a data condition.
    if (!user.churchId) return { status: "failed" };

    // The hidden input is server-rendered inside this form, so EVERY submit
    // carries it — a submit with JavaScript, and a plain browser POST of the
    // progressively-enhanced form alike. A press with no id is therefore not a
    // client of this panel, and it gets no unguarded decline: it is refused
    // here rather than passed down as "the client named nothing".
    const posted = formData.get("transitionId");
    if (typeof posted !== "string" || posted.length === 0) {
      return { status: "failed" };
    }

    const result = await declinePhaseTemplatePrompt({
      churchId: user.churchId,
      userId: user.id,
      expectedTransitionId: posted,
    });

    const decision = decidePhaseTemplateDismissOutcome(result);

    if (decision.answeredTransitionId) {
      refresh();
    }

    return decision.outcome;
  } catch (error) {
    console.error("dismissPhaseTemplatePromptAction error:", error);
    return { status: "failed" };
  }
}
