import assert from "node:assert/strict";
import { test } from "node:test";

import { PHASES } from "@/lib/constants";

import { planTemplateImport } from "./import";
import {
  buildPhaseTemplatePrompt,
  decidePhaseTemplateDismissOutcome,
  decidePhaseTemplateImportOutcome,
  decodePartialImportReceipt,
  encodePartialImportReceipt,
  handlePhaseChangedForTemplatePrompt,
  receiptForTransition,
  type AcceptPhaseTemplatePromptResult,
  type PhaseTemplateOffer,
  type PhaseTransitionRow,
} from "./phase-prompt";
import { TASK_TEMPLATES, phaseTemplatesFor } from "./templates";

// ----------------------------------------------------------------------------
// T-020 — the half with no database in it.
//
// `buildPhaseTemplatePrompt` is a pure function of (the latest transition row,
// the answer on record), which is what makes "prompt state" testable at any
// clock value and makes the relative-date promise checkable without writing a
// task. The two decision seams and the receipt codec are pure for the same
// reason and are asserted here too — they were written for the component's
// server actions, but a `"use server"` closure cannot be called from a test,
// which is exactly why the branching was lifted out of one.
// `phase-prompt-live.test.ts` proves the rows.
// ----------------------------------------------------------------------------

const MARCH = new Date("2026-03-02T09:15:00.000Z");
const SEPTEMBER = new Date("2026-09-14T23:45:00.000Z");

/** The transition every decision and receipt fixture below is answering. Not
 *  the one `transition()` builds — nothing here reads a prompt. */
const TRANSITION_ID = "22222222-2222-4222-8222-222222222222";

function transition(overrides: Partial<PhaseTransitionRow> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    fromPhase: 1,
    toPhase: 2,
    createdAt: MARCH,
    ...overrides,
  } satisfies PhaseTransitionRow;
}

// ----------------------------------------------------------------------------
// Which templates a phase offers
// ----------------------------------------------------------------------------

test("a phase offers exactly the catalog's templates for it", () => {
  for (const phase of Object.keys(PHASES).map(Number)) {
    const offered = phaseTemplatesFor(phase);

    assert.deepEqual(
      offered.map((template) => template.key),
      TASK_TEMPLATES.filter((template) => template.phase === phase).map(
        (template) => template.key
      )
    );
    assert.ok(
      offered.every((template) => template.phase === phase),
      `phaseTemplatesFor(${phase}) returned a template from another phase`
    );
  }
});

// ----------------------------------------------------------------------------
// Transition -> prompt state
// ----------------------------------------------------------------------------

test("a transition surfaces the new phase's templates", () => {
  const prompt = buildPhaseTemplatePrompt(transition(), null);

  assert.ok(prompt);
  assert.equal(prompt.toPhase, 2);
  assert.equal(prompt.phaseName, PHASES[2]);
  assert.deepEqual(
    prompt.offers.map((offer) => offer.key),
    phaseTemplatesFor(2).map((template) => template.key)
  );
  assert.equal(
    prompt.totalTaskCount,
    phaseTemplatesFor(2).reduce((total, t) => total + t.items.length, 0)
  );
});

test("the templates offered are the NEW phase's, never the old one's", () => {
  const prompt = buildPhaseTemplatePrompt(
    transition({ fromPhase: 4, toPhase: 2 }),
    null
  );

  assert.ok(prompt);

  const fromPhaseKeys = new Set(
    phaseTemplatesFor(4).map((template) => template.key)
  );
  for (const offer of prompt.offers) {
    assert.ok(
      !fromPhaseKeys.has(offer.key),
      `${offer.key} belongs to the phase the plant LEFT`
    );
  }
});

test("a backward move still prompts — the planter is doing that stage's work", () => {
  const prompt = buildPhaseTemplatePrompt(
    transition({ fromPhase: 3, toPhase: 1 }),
    null
  );

  assert.ok(prompt);
  assert.equal(prompt.toPhase, 1);
});

test("no transition prompts nothing", () => {
  assert.equal(buildPhaseTemplatePrompt(null, null), null);
});

test("a move that went nowhere prompts nothing", () => {
  assert.equal(
    buildPhaseTemplatePrompt(transition({ fromPhase: 2, toPhase: 2 }), null),
    null
  );
});

test("a phase with no templates prompts nothing", () => {
  // The catalog covers 0–6, so this is the guard for a phase number it has not
  // caught up with. The assertion is the ABSENCE, and the precondition is
  // asserted first so a catalog that grows a phase 9 fails here loudly rather
  // than quietly stops testing anything.
  assert.equal(phaseTemplatesFor(9).length, 0);
  assert.equal(
    buildPhaseTemplatePrompt(transition({ toPhase: 9 }), null),
    null
  );
});

// ----------------------------------------------------------------------------
// Declining
// ----------------------------------------------------------------------------

test("an answered transition does not prompt again", () => {
  const row = transition();

  assert.ok(buildPhaseTemplatePrompt(row, null));
  assert.equal(buildPhaseTemplatePrompt(row, row.id), null);
});

test("the RECORDED answer silences the prompt with no cookie in sight", () => {
  // The ruling of 2026-08-10: the answer lives in `phase_prompt_answers`, keyed
  // by transition id, so a second device — which sends no cookie — is answered
  // by the row that came back on the transition.
  const answered = transition({ answeredAt: new Date("2026-03-02T10:00:00Z") });

  assert.equal(buildPhaseTemplatePrompt(answered, null), null);
});

test("the recorded answer silences only the transition it names", () => {
  const answered = transition({ answeredAt: new Date("2026-03-02T10:00:00Z") });
  const next = transition({
    id: "22222222-2222-4222-8222-222222222222",
    fromPhase: 2,
    toPhase: 3,
    createdAt: SEPTEMBER,
  });

  assert.equal(buildPhaseTemplatePrompt(answered, null), null);
  assert.ok(
    buildPhaseTemplatePrompt(next, null),
    "the next move must re-arm the prompt"
  );
});

test("a cookie can hide a prompt but never restore one", () => {
  // The asymmetry that makes a forged cookie harmless AND makes the row
  // authoritative: neither answer can be argued away by the browser.
  const answered = transition({ answeredAt: new Date("2026-03-02T10:00:00Z") });

  assert.equal(
    buildPhaseTemplatePrompt(answered, "a-different-transition-id"),
    null,
    "a cookie naming another transition must not resurrect an answered prompt"
  );
});

test("an answer to an EARLIER transition does not silence the next one", () => {
  // This is what makes the prompt re-arm by itself: the stored answer names a
  // transition, so the next move stops matching it.
  const answered = transition();
  const next = transition({
    id: "22222222-2222-4222-8222-222222222222",
    fromPhase: 2,
    toPhase: 3,
    createdAt: SEPTEMBER,
  });

  assert.equal(buildPhaseTemplatePrompt(answered, answered.id), null);
  assert.ok(buildPhaseTemplatePrompt(next, answered.id));
});

// ----------------------------------------------------------------------------
// Dates relative to the transition, at two clock values
// ----------------------------------------------------------------------------

test("the dates offered are counted from the transition, not from a fixed calendar", () => {
  const inMarch = buildPhaseTemplatePrompt(
    transition({ createdAt: MARCH }),
    null
  );
  const inSeptember = buildPhaseTemplatePrompt(
    transition({ createdAt: SEPTEMBER }),
    null
  );

  assert.ok(inMarch);
  assert.ok(inSeptember);
  assert.equal(inMarch.offers.length, inSeptember.offers.length);

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const gapDays = Math.round(
    (Date.parse("2026-09-14T00:00:00Z") - Date.parse("2026-03-02T00:00:00Z")) /
      MS_PER_DAY
  );

  for (const [index, marchOffer] of inMarch.offers.entries()) {
    const septemberOffer: PhaseTemplateOffer = inSeptember.offers[index];
    assert.equal(septemberOffer.key, marchOffer.key);

    for (const field of ["firstDueDate", "lastDueDate"] as const) {
      const moved =
        (Date.parse(`${septemberOffer[field]}T00:00:00Z`) -
          Date.parse(`${marchOffer[field]}T00:00:00Z`)) /
        MS_PER_DAY;

      assert.equal(
        moved,
        gapDays,
        `${marchOffer.key}.${field} did not move with the transition date`
      );
    }
  }
});

test("the dates offered are the dates the import would write", () => {
  // The prompt and the import must not be able to disagree — one is what the
  // planter reads before pressing, the other is what lands in the table.
  const row = transition({ createdAt: SEPTEMBER });
  const prompt = buildPhaseTemplatePrompt(row, null);
  assert.ok(prompt);

  for (const offer of prompt.offers) {
    const template = phaseTemplatesFor(row.toPhase).find(
      (candidate) => candidate.key === offer.key
    );
    assert.ok(template);

    const dueDates = planTemplateImport(template, row.createdAt)
      .tasks.map((task) => task.dueDate)
      .sort();

    assert.equal(offer.firstDueDate, dueDates[0]);
    assert.equal(offer.lastDueDate, dueDates.at(-1));
    assert.equal(offer.taskCount, template.items.length);
  }
});

test("the transition instant's hour cannot move a due date", () => {
  // Day arithmetic, not instant arithmetic: a plant moved at 23:45 UTC and one
  // moved at 00:15 the same day get the same checklist dates.
  const early = buildPhaseTemplatePrompt(
    transition({ createdAt: new Date("2026-09-14T00:15:00.000Z") }),
    null
  );
  const late = buildPhaseTemplatePrompt(
    transition({ createdAt: new Date("2026-09-14T23:45:00.000Z") }),
    null
  );

  assert.ok(early);
  assert.ok(late);
  assert.deepEqual(
    early.offers.map((offer) => [offer.firstDueDate, offer.lastDueDate]),
    late.offers.map((offer) => [offer.firstDueDate, offer.lastDueDate])
  );
});

// ----------------------------------------------------------------------------
// The decision seam (ruled 2026-08-12, round 3)
//
// All of this used to live inside `importPhaseTemplatesAction`, a non-exported
// `"use server"` closure that no test can call — so the branch that matters
// most had no coverage at all, and shipped a `revalidatePath("/tasks")` that
// unmounted the very receipt it was written to preserve.
// ----------------------------------------------------------------------------

test("nothing answered leaves the prompt up and re-reads nothing", () => {
  // `null` is "no live prompt, or every requested key was forged" — and it is
  // also the empty tick list, which the action never sends to the service.
  const decision = decidePhaseTemplateImportOutcome(null);

  assert.deepEqual(decision.outcome, { status: "nothing" });
  assert.equal(decision.answeredTransitionId, null, "an unanswered prompt");
  assert.equal(decision.receipt, null, "nothing landed, so nothing to report");
});

test("a PARTIAL import hands its receipt to the SERVER, not to the island", () => {
  // THE REGRESSION THIS FILE EXISTS FOR, and the second attempt at it.
  //
  // The first fix returned `{status:"partial"}` for `useActionState` to render
  // and asked for no revalidation, on the theory that re-reading nothing keeps
  // the island alive. It cannot: the claim is KEPT on a part-way import, so the
  // transition is answered — and the action writes the answered-cookie, which
  // by itself re-renders the route ("after you set or delete a cookie in a
  // Server Action, Next.js re-renders the current page and its layouts on the
  // server", .next-docs/01-app/03-api-reference/04-functions/cookies.mdx). That
  // render has no prompt in it, so the island and its receipt were gone before
  // they could be seen: 16 of 22 tasks created, the stage change spent, and not
  // one word on screen.
  //
  // So the decision carries a RECEIPT — a value for the next server render,
  // written to a flash cookie — and the outcome it hands the doomed island is
  // the resting one.
  const result: AcceptPhaseTemplatePromptResult = {
    status: "partial",
    transitionId: TRANSITION_ID,
    importedOn: "2026-03-02",
    createdCount: 9,
    templateNames: ["Ministry Team Setup"],
  };

  const decision = decidePhaseTemplateImportOutcome(result);

  assert.deepEqual(
    decision.receipt,
    {
      // The receipt names its own transition, so the render that draws it can
      // check it is still the one being reported on.
      transitionId: TRANSITION_ID,
      createdCount: 9,
      templateNames: ["Ministry Team Setup"],
    },
    "a part-way import reported nothing the next render could draw"
  );
  assert.deepEqual(decision.outcome, { status: "idle" });
  assert.equal(
    decision.answeredTransitionId,
    TRANSITION_ID,
    "the claim is kept, so the cookie fast path must be written too"
  );
});

test("a clean import takes the prompt down and reports no receipt", () => {
  const decision = decidePhaseTemplateImportOutcome({
    status: "imported",
    transitionId: TRANSITION_ID,
    importedOn: "2026-03-02",
    createdCount: 22,
    templateNames: ["Ministry Team Setup", "Launch Prep"],
  });

  assert.deepEqual(decision.outcome, { status: "idle" });
  assert.equal(
    decision.receipt,
    null,
    "a clean import left a receipt for a failure that did not happen"
  );
  assert.equal(decision.answeredTransitionId, TRANSITION_ID);
});

test("a second press is a success that created nothing", () => {
  const decision = decidePhaseTemplateImportOutcome({
    status: "already_answered",
    transitionId: TRANSITION_ID,
  });

  assert.deepEqual(
    decision.outcome,
    { status: "idle" },
    "answering twice reported a failure the planter cannot act on"
  );
  assert.equal(decision.receipt, null);
  assert.equal(
    decision.answeredTransitionId,
    TRANSITION_ID,
    "the prompt is answered and must come down"
  );
});

test("a second press writes NO browser fast path — the row it found is not its own", () => {
  // `memory/invariants.md` → Tasks: `PHASE_TEMPLATE_PROMPT_COOKIE` "may only
  // ever suppress a prompt the row suppresses too — never restore one". That
  // rule has exactly one way to break, and this is it.
  //
  // Two presses land in the same millisecond. The winner claims the answer row;
  // the loser's `ON CONFLICT DO NOTHING` returns nothing and it reports
  // `already_answered`. Then the winner's very first `importTaskTemplate`
  // throws — nothing was created — so `acceptPhaseTemplatePrompt` RELEASES the
  // claim and the row is deleted, which is the whole point of releasing it: the
  // prompt is honestly unanswered and must come back.
  //
  // It comes back from the row. It does not come back through a cookie, and the
  // cookie lives for a YEAR with no un-answer path — so a fast path minted here
  // would hide the planter's prompt permanently, in the one browser that
  // pressed, with nothing imported. The loser therefore re-reads the route and
  // lets the row answer.
  const decision = decidePhaseTemplateImportOutcome({
    status: "already_answered",
    transitionId: TRANSITION_ID,
  });

  assert.equal(
    decision.fastPathTransitionId,
    null,
    "a press that wrote no row minted a year-long cookie against somebody else's claim — which a released claim turns into a prompt suppressed with nothing behind it"
  );
  assert.equal(
    decision.answeredTransitionId,
    TRANSITION_ID,
    "the route must still be re-read: if the row IS durable the prompt comes down from it"
  );
});

test("only a press that KEEPS its claim mints the fast path", () => {
  // The other side of the rule. `imported` and `partial` both hold the claim
  // they wrote and neither is ever released, so the cookie they mint can only
  // agree with the row. `partial` must mint one for a second reason: the cookie
  // write is what re-renders the route that draws its receipt.
  const imported = decidePhaseTemplateImportOutcome({
    status: "imported",
    transitionId: TRANSITION_ID,
    importedOn: "2026-03-02",
    createdCount: 22,
    templateNames: ["Ministry Team Setup"],
  });
  assert.equal(imported.fastPathTransitionId, TRANSITION_ID);

  const partial = decidePhaseTemplateImportOutcome({
    status: "partial",
    transitionId: TRANSITION_ID,
    importedOn: "2026-03-02",
    createdCount: 9,
    templateNames: ["Ministry Team Setup"],
  });
  assert.equal(
    partial.fastPathTransitionId,
    TRANSITION_ID,
    "a part-way import keeps its claim, and the cookie write is what re-renders the route its receipt is drawn on"
  );

  // Nothing answered, nothing minted.
  assert.equal(
    decidePhaseTemplateImportOutcome(null).fastPathTransitionId,
    null
  );
});

test("declining decides the same way, from what the service reported", () => {
  const landed = decidePhaseTemplateDismissOutcome({
    status: "declined",
    transitionId: TRANSITION_ID,
  });
  assert.deepEqual(landed.outcome, { status: "idle" });
  assert.equal(landed.answeredTransitionId, TRANSITION_ID);

  // No transition to decline, or the one on screen is no longer the plant's
  // current one: the press changed nothing, which from the planter's side IS a
  // failure — and nothing is answered, so nothing is re-read and the real
  // prompt is still there on the next render.
  const missed = decidePhaseTemplateDismissOutcome(null);
  assert.deepEqual(missed.outcome, { status: "failed" });
  assert.equal(missed.answeredTransitionId, null);
});

test('"Not now" writes NO browser fast path when the row it found is not its own', () => {
  // THE MIRROR OF THE IMPORT RULE, and the hole it was written to close. The
  // cookie rule is about the COOKIE, not about Import: `declinePhaseTemplate-
  // Prompt` used to return the transition id whether or not its
  // `ON CONFLICT DO NOTHING` actually wrote, so "Not now" minted the year-long
  // fast path off `answeredTransitionId` without owning the answer row.
  //
  // The losing sequence is the import one with the buttons swapped. A decline
  // and an Import land in the same millisecond; Import claims the row, the
  // decline's insert conflicts and it reports `already_answered`. Then Import's
  // first `importTaskTemplate` throws, nothing was created, and the claim is
  // RELEASED. The transition is now genuinely unanswered and the next render
  // must ask again — but the declining browser holds a 365-day cookie that
  // suppresses the prompt before the row is ever consulted, with nothing
  // imported and no un-answer path. That browser never sees this stage change
  // again.
  const decision = decidePhaseTemplateDismissOutcome({
    status: "already_answered",
    transitionId: TRANSITION_ID,
  });

  assert.equal(
    decision.fastPathTransitionId,
    null,
    "a decline that wrote no row minted a year-long cookie against somebody else's claim — released, that claim leaves a prompt suppressed with nothing behind it"
  );
  assert.equal(
    decision.answeredTransitionId,
    TRANSITION_ID,
    "the route must still be re-read: if the row IS durable the prompt comes down from it"
  );
  assert.deepEqual(
    decision.outcome,
    { status: "idle" },
    "losing the race is still a decline — the prompt is down either way, and the planter has nothing to act on"
  );
});

test("only a decline that WROTE its row mints the fast path", () => {
  // The other side of the mirror. Nothing ever releases a DECLINE — there is no
  // import behind it that could fail — so a cookie minted by the press that
  // wrote the row can only ever agree with the row.
  const declined = decidePhaseTemplateDismissOutcome({
    status: "declined",
    transitionId: TRANSITION_ID,
  });
  assert.equal(declined.fastPathTransitionId, TRANSITION_ID);

  // Nothing answered, nothing minted.
  assert.equal(
    decidePhaseTemplateDismissOutcome(null).fastPathTransitionId,
    null
  );
});

// ----------------------------------------------------------------------------
// The receipt's road: action → flash cookie → the NEXT server render
//
// The value crosses a browser to get there, so the codec is the trust boundary:
// `/tasks` has no error boundary (see the header of
// `src/db/migrations/0037_phase_prompt_answers.sql`), and a `JSON.parse` throw
// in the render of a cookie the browser controls is a 500 on the task list.
// ----------------------------------------------------------------------------

test("a receipt survives the round trip through a cookie value", () => {
  const receipt = {
    transitionId: TRANSITION_ID,
    createdCount: 16,
    templateNames: ["Ministry Team Setup", "Launch Prep & Follow-up"],
  };

  const encoded = encodePartialImportReceipt(receipt);

  assert.doesNotMatch(
    encoded,
    /[;,\s]/,
    "the cookie value carries a character that ends a cookie"
  );
  assert.deepEqual(decodePartialImportReceipt(encoded), receipt);
});

test("no cookie a browser can send makes the task list throw", () => {
  // Every one of these is reachable: no cookie at all, a cleared one, a proxy
  // that mangled the encoding, a hand-written one, and a value shaped like a
  // receipt that reports an import which cannot have happened.
  const refused = [
    undefined,
    null,
    "",
    "%%%",
    "not-json",
    encodeURIComponent("[]"),
    encodeURIComponent("null"),
    encodeURIComponent('"16"'),
    encodeURIComponent(
      JSON.stringify({ transitionId: TRANSITION_ID, createdCount: 16 })
    ),
    encodeURIComponent(
      JSON.stringify({ transitionId: TRANSITION_ID, templateNames: ["A"] })
    ),
    encodeURIComponent(
      JSON.stringify({
        transitionId: TRANSITION_ID,
        createdCount: 0,
        templateNames: ["A"],
      })
    ),
    encodeURIComponent(
      JSON.stringify({
        transitionId: TRANSITION_ID,
        createdCount: -3,
        templateNames: ["A"],
      })
    ),
    encodeURIComponent(
      JSON.stringify({
        transitionId: TRANSITION_ID,
        createdCount: 1.5,
        templateNames: ["A"],
      })
    ),
    encodeURIComponent(
      JSON.stringify({
        transitionId: TRANSITION_ID,
        createdCount: 4,
        templateNames: "Launch Prep",
      })
    ),
    encodeURIComponent(
      JSON.stringify({
        transitionId: TRANSITION_ID,
        createdCount: 4,
        templateNames: [{ name: "A" }],
      })
    ),
    // …and a receipt that cannot say WHICH stage change it reports on. Nothing
    // can match it, so it could only ever be drawn unconditionally — which is
    // the stale-alarm bug. This arm also covers every receipt minted before the
    // id existed, still sitting in a browser through its two-minute `maxAge`.
    encodeURIComponent(
      JSON.stringify({ createdCount: 4, templateNames: ["A"] })
    ),
    encodeURIComponent(
      JSON.stringify({
        transitionId: "",
        createdCount: 4,
        templateNames: ["A"],
      })
    ),
    encodeURIComponent(
      JSON.stringify({
        transitionId: 42,
        createdCount: 4,
        templateNames: ["A"],
      })
    ),
    encodeURIComponent(
      JSON.stringify({
        transitionId: "x".repeat(65),
        createdCount: 4,
        templateNames: ["A"],
      })
    ),
  ];

  for (const value of refused) {
    assert.equal(
      decodePartialImportReceipt(value),
      null,
      `a receipt was read out of ${JSON.stringify(value)}`
    );
  }
});

test("a forged receipt cannot grow the page it renders", () => {
  // The cookie is not `httpOnly` — the browser clears it — so its content is
  // whatever its owner wants. It buys them one sentence in their own browser,
  // and it is clamped on the way back in.
  const forged = encodeURIComponent(
    JSON.stringify({
      transitionId: TRANSITION_ID,
      createdCount: 9,
      templateNames: Array.from({ length: 40 }, () => "x".repeat(500)),
    })
  );

  const receipt = decodePartialImportReceipt(forged);

  assert.ok(receipt, "a well-formed oversized receipt was refused outright");
  assert.ok(receipt.templateNames.length <= 8);
  for (const name of receipt.templateNames) {
    assert.ok(name.length <= 120);
  }
});

test("a receipt minted for one transition is never drawn for another", () => {
  // THE STALE ALARM. `PHASE_TEMPLATE_RECEIPT_COOKIE` is spent by being SHOWN
  // (`ClearReceiptCookie`), and a live prompt beats a receipt — so a receipt
  // that loses that race is never shown and never spent. Inside its two-minute
  // `maxAge`:
  //
  //   1. a part-way import of transition A writes the flash;
  //   2. the plant moves again before it is drawn (another member, the phase
  //      engine, an oversight action), so the render finds a prompt for B and
  //      skips the receipt branch entirely;
  //   3. the planter answers B — cleanly, everything imported, or declines;
  //   4. the next render has no prompt, reaches this branch, and the cookie for
  //      A is still sitting there.
  //
  // Drawn, it would say "the remaining checklists were not created, and this
  // stage change is now answered" in a `role="alert"` about a press where every
  // clause is false. A render cannot clear a cookie, so the id in the value is
  // the whole defence.
  const transitionA = TRANSITION_ID;
  const transitionB = "33333333-3333-4333-8333-333333333333";

  const flash = encodePartialImportReceipt({
    transitionId: transitionA,
    createdCount: 16,
    templateNames: ["Ministry Team Setup"],
  });

  // Step 4, with B answered: the receipt belongs to a superseded transition.
  assert.equal(
    receiptForTransition(flash, transitionB),
    null,
    "a receipt for a superseded transition is drawn over the answer the planter just gave"
  );

  // …and the ordinary case still draws, or the fix would have deleted the
  // feature instead of scoping it.
  assert.deepEqual(receiptForTransition(flash, transitionA), {
    transitionId: transitionA,
    createdCount: 16,
    templateNames: ["Ministry Team Setup"],
  });

  // A plant with no transition at all has nothing a receipt could be about.
  assert.equal(receiptForTransition(flash, null), null);
  assert.equal(receiptForTransition(undefined, transitionA), null);
});

// ----------------------------------------------------------------------------
// The subscription handler
// ----------------------------------------------------------------------------

test("the phase.changed handler creates nothing and never throws", async () => {
  // "Prompt, do not auto-create" as an executable rule. The handler touches no
  // database at all, which is asserted the only way that is honest here: it
  // resolves without one being reachable.
  await assert.doesNotReject(
    handlePhaseChangedForTemplatePrompt({
      type: "phase.changed",
      churchId: "33333333-3333-4333-8333-333333333333",
      fromPhase: 1,
      toPhase: 2,
      initiatedById: "44444444-4444-4444-8444-444444444444",
      rubricVersion: "rubric-v0",
      timestamp: MARCH,
    })
  );
});
