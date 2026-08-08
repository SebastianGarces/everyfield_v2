import assert from "node:assert/strict";
import { test } from "node:test";

import { ASSESSMENT_CADENCE, assessmentColdStart } from "./cold-start";

// ----------------------------------------------------------------------------
// F12 / OB-009 — what /phase says before the first assessment.
//
// The failure this replaces is silence: a planter who finishes setup and opens
// /phase the same minute sees no insights, no scorecard and no reason, which is
// indistinguishable from a broken product. What it must never do instead is
// promise a run that is not coming — so the two cold starts say different
// things, and the notice disappears entirely the moment an assessment exists.
// ----------------------------------------------------------------------------

test("an assessed plant gets no notice at all", () => {
  assert.equal(
    assessmentColdStart({
      hasAssessment: true,
      lastMaterialEventAt: new Date("2026-08-01T00:00:00Z"),
    }),
    null
  );

  // Even with nothing ever stamped: there is real content to read.
  assert.equal(
    assessmentColdStart({ hasAssessment: true, lastMaterialEventAt: null }),
    null
  );
});

test("a plant marked dirty is told the first run is coming, not asked to do anything", () => {
  const notice = assessmentColdStart({
    hasAssessment: false,
    lastMaterialEventAt: new Date("2026-08-05T12:00:00Z"),
  });

  assert.equal(notice?.kind, "queued");
  assert.match(notice.title, /on its way/i);
  assert.match(notice.body, /queue/i);
  assert.ok(notice.body.includes(ASSESSMENT_CADENCE));
});

test("a plant that has never had a material event is told what brings the run forward", () => {
  const notice = assessmentColdStart({
    hasAssessment: false,
    lastMaterialEventAt: null,
  });

  assert.equal(notice?.kind, "quiet");
  assert.match(notice.body, /core-group members|vision meeting/i);
  assert.ok(notice.body.includes(ASSESSMENT_CADENCE));
});

test("undefined is treated as never stamped, not as queued", () => {
  const notice = assessmentColdStart({
    hasAssessment: false,
    lastMaterialEventAt: undefined,
  });

  assert.equal(notice?.kind, "quiet");
});

test("neither notice claims an assessment is running right now", () => {
  for (const lastMaterialEventAt of [null, new Date()]) {
    const notice = assessmentColdStart({
      hasAssessment: false,
      lastMaterialEventAt,
    });

    // OB-009 marks the plant dirty; it does not trigger a run. Copy that said
    // "assessing now" would be a lie a planter could sit and wait on.
    assert.doesNotMatch(notice!.body, /running now|in progress|analyz/i);
  }
});
