import { refresh } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";

import {
  ClearReceiptCookie,
  PhaseTemplatePromptForm,
} from "@/components/tasks/phase-template-prompt-controls";
import { getCurrentSession, verifySession } from "@/lib/auth/session";
import { formatDate } from "@/lib/datetime";
import {
  PHASE_TEMPLATE_PROMPT_COOKIE,
  PHASE_TEMPLATE_PROMPT_COOKIE_MAX_AGE,
  PHASE_TEMPLATE_RECEIPT_COOKIE,
  PHASE_TEMPLATE_RECEIPT_COOKIE_MAX_AGE,
  acceptPhaseTemplatePrompt,
  decidePhaseTemplateDismissOutcome,
  decidePhaseTemplateImportOutcome,
  declinePhaseTemplatePrompt,
  encodePartialImportReceipt,
  readPhaseTemplatePrompt,
  receiptForTransition,
  type PhaseTemplateDismissOutcome,
  type PhaseTemplateImportOutcome,
  type PhaseTemplateOffer,
  type PhaseTemplatePartialReceipt,
  type PhaseTemplatePrompt as PhaseTemplatePromptData,
} from "@/lib/tasks/phase-prompt";
import {
  TEMPLATES_LINK_LABEL,
  TEMPLATES_ROUTE,
  taskCountLabel,
} from "@/lib/tasks/templates";

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
// actor with `verifySession()` ABOVE its `try` — not merely first inside it —
// which is the shape `memory/invariants.md` → Authentication requires of a NEW
// action. Inside the `try` the catch would convert a sessionless POST into a
// handled `{ status: "failed" }`; above it the rejection escapes, which is what
// an anonymous caller is owed. The 45 try-wrapped mints named in
// `TRY_WRAPPED_MINTS` (`src/lib/auth/server-action-surface.test.ts`) are a
// closed residual and these two are not in it — nor could they be, because that
// walk reads only the EXPORTS of `"use server"` modules and these are
// non-exported inline closures. The rule is the authority here, not the walk.
//
// EVERY OUTCOME IS SAID OUT LOUD (ruled 2026-08-12, round 3 on PR #393). Both
// actions used to return `void` and log their failures to the console. A press
// that writes 22–26 tasks may not fail silently, and the PARTIAL import is the
// case that has no second chance: the claim is kept by design, so the prompt is
// answered and never renders again. Each action therefore returns an outcome
// and the island renders it.
//
// …EXCEPT THE PARTIAL IMPORT, WHICH THE ISLAND CANNOT OUTLIVE. That was the
// first attempt and it failed its browser gate: 16 of 22 tasks created, the
// transition answered, and no receipt anywhere. An outcome is only renderable
// for as long as the component holding it is mounted, and answering the prompt
// removes it — `.next-docs/01-app/03-api-reference/04-functions/cookies.mdx`:
// "after you set or delete a cookie in a Server Action, Next.js re-renders the
// current page and its layouts on the server", and the answer always sets the
// fast-path cookie. That re-render finds an answered transition, so
// `PhaseTemplatePrompt` returns the receipt state instead of the prompt — and
// the island, receipt and all, is gone from the tree. No revalidation setting
// could have saved it, which is why the "revalidate nothing" machinery is gone
// too. The receipt travels in a flash cookie and is rendered HERE, on the
// server, by `PhaseTemplatePartialReceiptView`.
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

/**
 * What names the panel's `<section>` landmark.
 *
 * IT LIVES IN THIS FILE, WITH BOTH BODIES THAT CARRY IT. The panel asks in one
 * body and reports in the other, and the landmark has to keep its name in both:
 * `aria-labelledby` pointing at a heading that is no longer in the document
 * leaves the region unnamed. Both the prompt's lead and the receipt render an
 * `<h2>` with this id, and only one of them is ever mounted, so it stays unique.
 *
 * It used to live in the client island, and a server component imported it from
 * there — the one direction the RSC graph does not owe you a plain string back,
 * since every export of a `"use client"` module is a client reference on the
 * server. Nothing crosses that boundary now but the two action references.
 */
export const PHASE_TEMPLATE_PROMPT_HEADING_ID = "phase-template-prompt-heading";

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
 * Hand a part-way import's receipt to the render that is about to replace this
 * panel.
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

  const { user } = await verifySession();

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

    // BEFORE the answer cookie, because that one is what re-renders the route
    // and the re-render is what reads this one.
    if (decision.receipt) {
      await markPartialImportReceipt(decision.receipt);
    }

    if (decision.answeredTransitionId) {
      await markPromptAnswered(decision.answeredTransitionId);
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
 * device — the cookie afterwards only saves this browser the join.
 *
 * `null` from the service means there is no transition to decline, or the one
 * named is no longer current. Either way the press changed nothing, and from
 * the planter's side a press that changed nothing IS a failure.
 */
async function dismissPhaseTemplatePromptAction(
  _previous: PhaseTemplateDismissOutcome,
  formData: FormData
): Promise<PhaseTemplateDismissOutcome> {
  "use server";

  const { user } = await verifySession();

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

    const transitionId = await declinePhaseTemplatePrompt({
      churchId: user.churchId,
      userId: user.id,
      expectedTransitionId: posted,
    });

    const decision = decidePhaseTemplateDismissOutcome(transitionId);

    if (decision.answeredTransitionId) {
      await markPromptAnswered(decision.answeredTransitionId);
      refresh();
    }

    return decision.outcome;
  } catch (error) {
    console.error("dismissPhaseTemplatePromptAction error:", error);
    return { status: "failed" };
  }
}

// ----------------------------------------------------------------------------
// Copy helpers
// ----------------------------------------------------------------------------

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
// The receipt — the panel's other body
//
// SERVER MARKUP, AND THAT IS THE WHOLE FIX. It was client state in the prompt's
// island, and the island is removed from the tree by the very re-render the
// answer causes. Rendered here it is drawn by the render that replaces the
// prompt, from a flash cookie the action wrote — so it survives the press, a
// reload, and a browser with no JavaScript at all.
// ----------------------------------------------------------------------------

/** The receipt's own heading. The panel is no longer asking anything, so it no
 *  longer says which stage was moved to — it says what happened to the press. */
export const PARTIAL_IMPORT_HEADING = "Import partly finished";

/** `"A"`, `"A and B"`, `"A, B and C"` — names read as a sentence, not a list. */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The partial-import receipt, ending mid-sentence so the catalog link finishes
 * it (the same shape as the prompt's untick note).
 *
 * It says three things in order, because the planter needs all three: what DID
 * land, that the rest did not, and that the stage change is now spent — so the
 * remainder has exactly one route left.
 */
export function partialImportMessage(
  createdCount: number,
  templateNames: readonly string[]
): string {
  const created = taskCountLabel(createdCount);
  const from =
    templateNames.length > 0 ? ` from ${nameList(templateNames)}` : "";

  return `Only part of that import went through: ${created} created${from}. The remaining checklists were not created, and this stage change is now answered — import them at any time from`;
}

/**
 * The panel, reporting instead of asking.
 *
 * It REPLACES the prompt rather than sitting under it, and it has no buttons: a
 * part-way import keeps its claim (`phase-prompt.ts`), so the transition is
 * answered and the offers it was showing can no longer be taken. This is the
 * only screen that will ever say so — the prompt does not come back.
 *
 * `role="alert"` and not merely a paragraph, because the planter's attention is
 * on a press that appeared to work; and `ClearReceiptCookie` beside it so the
 * flash is spent by being read, rather than following them into their next
 * visit to `/tasks`.
 */
export function PhaseTemplatePartialReceiptView({
  receipt,
}: {
  receipt: PhaseTemplatePartialReceipt;
}) {
  return (
    <section
      aria-labelledby={PHASE_TEMPLATE_PROMPT_HEADING_ID}
      data-testid="phase-template-prompt"
      className="border-border bg-card space-y-4 rounded-md border p-4 shadow-sm"
    >
      <div
        data-testid="prompt-partial"
        role="alert"
        className="bg-destructive/10 text-destructive space-y-1 rounded-md p-3 text-sm"
      >
        <h2 id={PHASE_TEMPLATE_PROMPT_HEADING_ID} className="font-medium">
          {PARTIAL_IMPORT_HEADING}
        </h2>
        <p>
          {partialImportMessage(receipt.createdCount, receipt.templateNames)}{" "}
          <Link
            href={TEMPLATES_ROUTE}
            className="cursor-pointer font-medium underline underline-offset-4"
          >
            {TEMPLATES_LINK_LABEL}
          </Link>
          .
        </p>
      </div>
      <ClearReceiptCookie name={PHASE_TEMPLATE_RECEIPT_COOKIE} />
    </section>
  );
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
    state: PhaseTemplateDismissOutcome,
    formData: FormData
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
      aria-labelledby={PHASE_TEMPLATE_PROMPT_HEADING_ID}
      data-testid="phase-template-prompt"
      className="border-border bg-card space-y-4 rounded-md border p-4 shadow-sm"
    >
      {/*
        `data-testid` is a TEST SEAM, not styling. The structural tests assert
        that the lead stays two paragraphs and that both standing notes sit in
        the fine print — a rule about WHICH BLOCK a sentence lives in. Anchored
        to the serialized class string, those tests broke on a prettier class
        reorder; anchored here, they break only when a note actually moves.

        It sits BESIDE the island, not inside it. It was passed in as a prop so
        that a partial import could replace the panel body from client state —
        machinery that could never work, because answering the prompt unmounts
        the island. The receipt is a server render now, so the lead is plain
        server markup again.
      */}
      <div data-testid="prompt-lead" className="space-y-1">
        <h2
          id={PHASE_TEMPLATE_PROMPT_HEADING_ID}
          className="text-base font-medium"
        >
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

      <PhaseTemplatePromptForm
        transitionId={prompt.transitionId}
        offerCount={prompt.offers.length}
        importAction={importAction}
        dismissAction={dismissAction}
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
 * The prompt for the signed-in planter's plant, the receipt for a press that
 * half-landed, or nothing.
 *
 * Renders `null` — no wrapper, no empty state — whenever there is nothing to
 * ask about: no session, no church, no transition, an already-answered
 * transition, or a phase the catalog has no checklist for. A prompt that is
 * always present is not a prompt.
 *
 * "NO PROMPT" IS NOT THE SAME AS "NOTHING TO SAY", AND THAT IS THE FIX. A
 * part-way import ANSWERS the transition, so this loader is asked for a prompt
 * on exactly the render that owes the planter a receipt and correctly finds
 * none. Returning `null` there is the silence the round-3 ruling exists to end,
 * and it is what shipped: 16 of 22 tasks created and not a word on screen. So
 * the empty answer is where the flash cookie is read — written one render
 * earlier by `importPhaseTemplatesAction` and by nothing else.
 *
 * A LIVE PROMPT STILL WINS. The receipt is history; a prompt is a question the
 * planter can still answer. The cookie is normally spent the moment the receipt
 * is drawn, but with JavaScript off it lives out its `maxAge`, and a plant that
 * changes stage inside that window must get its new prompt, not a stale report.
 *
 * …AND A RECEIPT THAT LOST TO A LIVE PROMPT IS NEVER DRAWN LATER. That rule
 * above has a cost, and the cost is the second half of this branch. A receipt
 * beaten by a new prompt is not shown, so `ClearReceiptCookie` never runs and
 * the flash survives unspent; answer that new prompt — cleanly, everything
 * imported — and this branch is reached again with the old cookie still in it.
 * Drawn, it would state "the remaining checklists were not created" about a
 * press where nothing was left behind, in a `role="alert"`. A render cannot
 * clear a cookie (`cookies().set` is Server-Action-only), so the receipt
 * carries the transition it belongs to and `receiptForTransition` refuses every
 * other one — a superseded receipt renders nothing and expires on its `maxAge`.
 */
export async function PhaseTemplatePrompt() {
  const { user } = await getCurrentSession();
  if (!user?.churchId) return null;

  const cookieStore = await cookies();
  const answeredTransitionId =
    cookieStore.get(PHASE_TEMPLATE_PROMPT_COOKIE)?.value ?? null;

  // One read for both: the prompt, and the id of the transition this render is
  // reporting on — which the receipt below has to match.
  const { transitionId, prompt } = await readPhaseTemplatePrompt(
    user.churchId,
    answeredTransitionId
  );

  if (!prompt) {
    const receipt = receiptForTransition(
      cookieStore.get(PHASE_TEMPLATE_RECEIPT_COOKIE)?.value,
      transitionId
    );

    return receipt ? (
      <PhaseTemplatePartialReceiptView receipt={receipt} />
    ) : null;
  }

  return (
    <PhaseTemplatePromptView
      prompt={prompt}
      importAction={importPhaseTemplatesAction}
      dismissAction={dismissPhaseTemplatePromptAction}
    />
  );
}
