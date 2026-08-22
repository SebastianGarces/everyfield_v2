import assert from "node:assert/strict";
import { test } from "node:test";

import { generateObject, NoObjectGeneratedError } from "ai";
import { MockLanguageModelV3 } from "ai/test";

import { makeSnapshot } from "@/lib/phase-engine/signals/testing";

import { runPacedCall } from "./paced-call";
import { runAssessment } from "./run-assessment";
import {
  describeDraftRejection,
  isSchemaRejection,
  SchemaRejectionError,
  type SchemaRejectionEvent,
} from "./schema-rejection";
import { judgeOutputSchema, type Insight } from "./schema";
import { virtualClock } from "./testing";
import { TokenPacer } from "./token-pacer";

// ----------------------------------------------------------------------------
// #605: the judge's own rules rejected roughly one draft in four, and the run
// gave up on the plant.
//
// The rejection is not a transport failure — the provider answered, and the
// answer broke a rule stated in the rubric. Re-sending the SAME prompt draws
// the same mistake, which is what the throttle ladder was doing with it: a
// `NoObjectGeneratedError` carries no status code, so `isRetryableError` said
// yes and four identical attempts were spent before the plant was recorded
// `failed`.
//
// These tests pin the replacement. The throttle ladder refuses to own a
// rejected draft, and a second ladder re-prompts with the rule that rejected
// it — bounded, observable, and named in what it finally throws.
// ----------------------------------------------------------------------------

function insight(over: Partial<Insight> = {}): Insight {
  return {
    audience: "planter",
    category: "vision_casting",
    severity: "watch",
    title: "Vision meeting cadence is slipping",
    body: "It has been 21 days since your last vision meeting; the target is every two weeks.",
    citedFacts: ["visionMeetings.daysSinceLastMeeting=21"],
    relatedArticleSlugs: [],
    ...over,
  };
}

function draft(insights: Insight[]): string {
  return JSON.stringify({
    summary: "A plain-language read of overall plant health.",
    insights,
  });
}

/** Clean: one planter item, one network item paired to the same category. */
const GOOD_DRAFT = draft([
  insight(),
  insight({ audience: "network", title: "Vision cadence has lengthened" }),
]);

/** Breaks the pairing rule: the network hears a concern the planter does not. */
const UNPAIRED_DRAFT = draft([
  insight(),
  insight({
    audience: "network",
    category: "critical_mass",
    title: "Core-group momentum has slowed",
  }),
]);

/** Breaks audience coverage: planter only, so the network gets nothing. */
const PLANTER_ONLY_DRAFT = draft([insight()]);

/** A model that answers with each draft in turn and records what it was asked. */
function scriptedModel(drafts: string[]) {
  const prompts: string[] = [];
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      const text = drafts[Math.min(call, drafts.length - 1)];
      call++;
      return {
        content: [{ type: "text" as const, text }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: {
            total: 100,
            noCache: 100,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: 200, text: 200, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return {
    model,
    prompts,
    get calls() {
      return call;
    },
  };
}

async function assess(
  drafts: string[],
  options: Parameters<typeof runAssessment>[2] = {}
) {
  const scripted = scriptedModel(drafts);
  const events: SchemaRejectionEvent[] = [];
  const result = await runAssessment(makeSnapshot(), 1, {
    passages: [],
    model: scripted.model,
    onSchemaRejection: (event) => events.push(event),
    ...options,
  }).then(
    (value) => ({ value, error: null as unknown }),
    (error: unknown) => ({ value: null, error })
  );
  return { ...result, ...scripted, events };
}

// --- The throttle ladder must not own a rejected draft ----------------------

test("a rejected draft is not retried by the rate-limit ladder", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });
  let calls = 0;

  const model = scriptedModel([UNPAIRED_DRAFT]).model;

  await assert.rejects(
    runPacedCall(
      async () => {
        calls++;
        const generated = await generateObject({
          model,
          schema: judgeOutputSchema,
          prompt: "go",
          maxRetries: 0,
        });
        return { value: generated.object };
      },
      { pacer, maxAttempts: 4 }
    ),
    (error: unknown) => NoObjectGeneratedError.isInstance(error)
  );

  // Exactly one, not four. Re-sending the same prompt draws the same mistake,
  // and spending the throttle ladder on it leaves nothing for a real 429.
  assert.equal(calls, 1);
  assert.deepEqual(clock.sleeps, []);
});

// --- Naming the rule that rejected the draft --------------------------------

test("describeDraftRejection names the rule, not just the prose", async () => {
  const model = scriptedModel([UNPAIRED_DRAFT]).model;

  const error = await generateObject({
    model,
    schema: judgeOutputSchema,
    prompt: "go",
    maxRetries: 0,
  }).then(
    () => null,
    (e: unknown) => e
  );

  const rejection = describeDraftRejection(error);
  assert.ok(rejection, "a NoObjectGeneratedError is a draft rejection");
  assert.deepEqual(rejection.rules, ["planter_first_pairing"]);
  assert.match(rejection.messages.join(" "), /never discover a concern/);
});

test("describeDraftRejection ignores anything that is not a rejected draft", () => {
  assert.equal(describeDraftRejection(new Error("socket hang up")), null);
  assert.equal(describeDraftRejection(undefined), null);
});

// --- The schema ladder ------------------------------------------------------

test("a rejected draft is re-prompted with the rule it broke, and the retry lands", async () => {
  const run = await assess([UNPAIRED_DRAFT, GOOD_DRAFT]);

  assert.equal(run.error, null);
  assert.equal(run.calls, 2);
  assert.equal(run.value?.insights.length, 2);

  // The point of the retry: the second prompt carries the rejection back, so
  // the model is correcting a stated rule rather than rolling the dice again.
  assert.doesNotMatch(run.prompts[0], /REJECTED/);
  assert.match(run.prompts[1], /never discover a concern/);

  assert.equal(run.events.length, 1);
  assert.deepEqual(run.events[0].rules, ["planter_first_pairing"]);
  assert.equal(run.events[0].attempt, 1);
  assert.equal(run.events[0].exhausted, false);
});

test("missing audience coverage is a schema rule, so it is retried too", async () => {
  const run = await assess([PLANTER_ONLY_DRAFT, GOOD_DRAFT]);

  assert.equal(run.error, null);
  assert.equal(run.calls, 2);
  assert.deepEqual(run.events[0].rules, ["audience_coverage"]);
  assert.match(run.prompts[1], /at least one planter AND one network insight/);
});

test("a model that never complies fails with the rejecting rule named", async () => {
  // A virtual clock, because a re-prompt is a WHOLE EXTRA CALL against the run's
  // shared TPM budget: on the real clock this plant's third draft waits ~21s for
  // the bucket to refill. That is the ladder behaving — a retry queues like any
  // other call rather than jumping the batch — and it is why `deadlineAt` has to
  // bound this loop as well as the throttle one.
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  const run = await assess([UNPAIRED_DRAFT], { pacer, maxSchemaAttempts: 3 });

  assert.ok(isSchemaRejection(run.error));
  const error = run.error as SchemaRejectionError;
  assert.equal(run.calls, 3);
  assert.equal(error.attempts, 3);
  assert.deepEqual(error.rules, ["planter_first_pairing"]);
  assert.equal(error.reason, "attempts_exhausted");
  // AC-3: the rule is in the message, so the operator reading a `failed` row's
  // log line never has to reproduce the run to learn which rule rejected it.
  assert.match(error.message, /planter_first_pairing/);
  // The drafts really did queue behind the token bucket rather than bypass it.
  assert.ok(clock.now() > 0, "a re-prompt is paced like any other call");

  assert.equal(run.events.length, 3);
  assert.equal(run.events[2].exhausted, true);
});

test("the ladder stands down on the run deadline instead of overrunning it", async () => {
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });

  const run = await assess([UNPAIRED_DRAFT], {
    pacer,
    maxSchemaAttempts: 3,
    deadlineAt: clock.now(),
  });

  assert.ok(isSchemaRejection(run.error));
  assert.equal((run.error as SchemaRejectionError).reason, "run_budget");
  // One draft, then stood down: the run's clock, not the attempt count.
  assert.equal(run.calls, 1);
});

test("a non-rejection failure still travels as itself", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error("bad gateway");
    },
  });

  await assert.rejects(
    runAssessment(makeSnapshot(), 1, {
      passages: [],
      model,
      maxAttempts: 1,
    }),
    /bad gateway/
  );
});
