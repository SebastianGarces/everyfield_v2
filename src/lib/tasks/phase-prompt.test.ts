import assert from "node:assert/strict";
import { test } from "node:test";

import { PHASES } from "@/lib/constants";

import { planTemplateImport } from "./import";
import {
  buildPhaseTemplatePrompt,
  handlePhaseChangedForTemplatePrompt,
  phaseTemplatesFor,
  type PhaseTemplateOffer,
  type PhaseTransitionRow,
} from "./phase-prompt";
import { TASK_TEMPLATES } from "./templates";

// ----------------------------------------------------------------------------
// T-020 — the half with no database in it.
//
// `buildPhaseTemplatePrompt` is a pure function of (the latest transition row,
// the answer on record), which is what makes "prompt state" testable at any
// clock value and makes the relative-date promise checkable without writing a
// task. `phase-prompt-live.test.ts` proves the rows.
// ----------------------------------------------------------------------------

const MARCH = new Date("2026-03-02T09:15:00.000Z");
const SEPTEMBER = new Date("2026-09-14T23:45:00.000Z");

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
