import assert from "node:assert/strict";
import { test } from "node:test";

import { findBenchmarkMentions, findGatePhrasing } from "./benchmark-language";

// ----------------------------------------------------------------------------
// The detector behind the #472 wiki sweep (C03).
//
// The corpus lives in `wiki_articles`, a protected table with no repo seed, so
// the content pass leaves no diff. `scripts/audit-benchmark-language.ts` is
// what a reviewer re-runs instead — and it is only worth re-running if the
// detector is right about what a gate claim looks like. Hence these.
//
// The two failure modes are equal and opposite. Missing a gate claim leaves
// Bryan's objection unaddressed. Flagging every mention of the number makes the
// audit noise nobody reads, and the corpus is FULL of legitimate mentions.
// ----------------------------------------------------------------------------

test("a benchmark stated as a requirement is a finding", () => {
  const findings = findGatePhrasing(
    "You need to build toward 50-100 committed adults before you can launch effectively."
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].trigger, "before you can launch");
});

test("the number stated as this methodology's benchmark is not", () => {
  assert.deepEqual(
    findGatePhrasing(
      "This methodology builds toward 50-100 committed adults before launch. " +
        "Different contexts and models reasonably launch at very different sizes."
    ),
    []
  );
});

test("the subject may live in the paragraph rather than the sentence", () => {
  // "50 is the minimum." is four words and mentions no people. It is also
  // exactly the claim this sweep removes, so a sentence-only test would have
  // let the worst line in the corpus through.
  const findings = findGatePhrasing(
    "Aim high on Launch Team size.\n50 is the minimum. 100 is the target. Below 50 adults you are underpowered."
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].trigger, "the minimum");
});

test("a number about anything other than people is ignored", () => {
  assert.deepEqual(
    findGatePhrasing("Name tags are required — 50+ blank tags per meeting."),
    []
  );
  assert.deepEqual(
    findGatePhrasing(
      "You must secure $50,000 in committed monthly giving by the launch date."
    ),
    []
  );
});

test("gate grammar about something else in a sizing paragraph is ignored", () => {
  // "required" is about the training, not about the 50.
  assert.deepEqual(
    findGatePhrasing(
      "Your core group is 50 adults. Boot Camp is required for every team leader."
    ),
    []
  );
});

test("the worklist is wider than the findings", () => {
  const content =
    "This methodology builds toward 50-100 committed adults before launch.";
  assert.deepEqual(findGatePhrasing(content), []);
  assert.deepEqual(findBenchmarkMentions(content), [content]);
});
