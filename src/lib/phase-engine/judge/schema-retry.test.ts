import assert from "node:assert/strict";
import { test } from "node:test";

import { generateObject, NoObjectGeneratedError } from "ai";
import { MockLanguageModelV3 } from "ai/test";

import { makeSnapshot } from "@/lib/phase-engine/signals/testing";

import { runPacedCall } from "./paced-call";
import { runAssessment } from "./run-assessment";
import {
  carryCorrectionForward,
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
  assert.match(
    rejection.issues.map((issue) => issue.message).join(" "),
    /never discover a concern/
  );
  assert.equal(rejection.issues[0].rule, "planter_first_pairing");
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

// --- Not trading one rule for another ---------------------------------------

/** Breaks the verdict register: a network insight delivering a judgement. */
const VERDICT_DRAFT = draft([
  insight(),
  insight({
    audience: "network",
    title: "Vision cadence is failing",
    body: "The plant is behind on its vision meeting cadence and this needs to be addressed.",
  }),
]);

test("a rule stays in the correction until a draft stops breaking it", async () => {
  // The EVAL-05 sequence, as measured on the fleet: told its network language
  // delivered a verdict, the model softened it and came back unpaired. If the
  // second correction only carried the pairing message, the third draft is free
  // to reach for verdict language again — which is how a plant burned its whole
  // ladder while every draft honestly fixed what it was last told.
  const clock = virtualClock();
  const pacer = new TokenPacer({ clock });
  const run = await assess([VERDICT_DRAFT, UNPAIRED_DRAFT, GOOD_DRAFT], {
    pacer,
  });

  assert.equal(run.error, null);
  assert.equal(run.calls, 3);

  // Draft 2 is told about the verdict register.
  assert.match(run.prompts[1], /must coach, never deliver a verdict/);
  // Draft 3 is told to fix the pairing AND to keep the verdict register it has
  // just satisfied — both, in one prompt.
  assert.match(run.prompts[2], /never discover a concern/);
  assert.match(run.prompts[2], /must coach, never deliver a verdict/);
  assert.match(run.prompts[2], /do not fix the points above by breaking one/);
});

test("carryCorrectionForward drops a rule the newest draft broke again", () => {
  const first = {
    rule: "network_verdict_register" as const,
    message: "verdict",
  };
  const second = { rule: "planter_first_pairing" as const, message: "pairing" };

  const one = carryCorrectionForward(null, {
    issues: [first],
    rules: ["network_verdict_register"],
  });
  assert.deepEqual(one, { fix: [first], keep: [] });

  const two = carryCorrectionForward(one, {
    issues: [second],
    rules: ["planter_first_pairing"],
  });
  assert.deepEqual(two, { fix: [second], keep: [first] });

  // Broken again: it is something to FIX now, never both at once.
  const three = carryCorrectionForward(two, {
    issues: [first],
    rules: ["network_verdict_register"],
  });
  assert.deepEqual(three, { fix: [first], keep: [second] });
});

test("carryCorrectionForward never carries a shape issue", () => {
  const shape = { rule: null, message: "insights.0.body: Too small" };
  const rule = { rule: "observation_budget" as const, message: "budget" };

  const one = carryCorrectionForward(null, { issues: [shape], rules: [] });
  const two = carryCorrectionForward(one, {
    issues: [rule],
    rules: ["observation_budget"],
  });

  // A shape complaint names a specific insight in a specific draft; repeating
  // it against the next one is noise the model cannot act on.
  assert.deepEqual(two.keep, []);
});

test("a truncated draft is never re-prompted — a longer prompt cannot fix it", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      // Valid as far as it goes, but the token cap ended it. The correction
      // block only makes the next prompt longer, so re-prompting would spend
      // three completions on a draft that cannot come back shorter.
      content: [{ type: "text" as const, text: PLANTER_ONLY_DRAFT }],
      finishReason: { unified: "length" as const, raw: "length" },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 200, text: 200, reasoning: 0 },
      },
      warnings: [],
    }),
  });

  const events: SchemaRejectionEvent[] = [];
  await assert.rejects(
    runAssessment(makeSnapshot(), 1, {
      passages: [],
      model,
      maxAttempts: 1,
      onSchemaRejection: (event) => events.push(event),
    }),
    (error: unknown) => NoObjectGeneratedError.isInstance(error)
  );

  // The provider's own error travels up as itself; the ladder never engages.
  assert.deepEqual(events, []);
});

test("a model that never complies fails with the rejecting rule named", async () => {
  // A virtual clock, because a re-prompt is a WHOLE EXTRA CALL against the run's
  // shared TPM budget: against the real per-call estimate this plant's third
  // draft waits ~21s for the bucket to refill. That is the ladder behaving — a
  // retry queues like any other call rather than jumping the batch — and it is
  // why `deadlineAt` has to bound this loop as well as the throttle one.
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

  // A REJECTED DRAFT IS A PAID COMPLETION AND THE PACER MUST SEE IT. The mock
  // reports 300 tokens; the pacer keeps 10% headroom over what it measures. If
  // the rejection path skipped `observeResponse`, this would still read the
  // built-in estimate, and a plant burning three completions would be metered
  // as one — the re-prompt being the longest of the three.
  assert.equal(pacer.estimatedTokensPerCall, 330);

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
