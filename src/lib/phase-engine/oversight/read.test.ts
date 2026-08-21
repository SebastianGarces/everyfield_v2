import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlantInsight } from "@/db/schema";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";

import {
  classifyPlantHealth,
  computeHasSharedContent,
  privacyFeatureForCategory,
  READINESS_LAUNCH_WINDOW_DAYS,
} from "./read";

// ----------------------------------------------------------------------------
// Pure health classification (PE-017) + privacy-category mapping (AC-PE-9).
// No DB, no LLM — the privacy-gated portfolio read is exercised by these
// building blocks. `classifyPlantHealth` is fed only the insights that already
// survived gating, mirroring the read path.
// ----------------------------------------------------------------------------

type Sev = PlantInsight["severity"];

function insight(severity: Sev): Pick<PlantInsight, "severity"> {
  return { severity };
}

/**
 * A snapshot's launch block, built the way `buildLaunchSignals` builds it.
 *
 * `isPastDue` is DERIVED here rather than passed, because that is the whole
 * point of the field: a launch recorded as `completed` is never past due,
 * however long ago the day was. A fixture that set only `daysUntilLaunch` is
 * what let the classifier read a negative countdown as "overdue" for the life of
 * every plant that launched successfully.
 */
function snapshotWithLaunch(
  daysUntilLaunch: number | null,
  status: "planning" | "scheduled" | "postponed" | "completed" = "scheduled"
): PlantFactSnapshot {
  return {
    launch: {
      daysUntilLaunch,
      status,
      isCompleted: status === "completed",
      isPastDue:
        daysUntilLaunch !== null &&
        daysUntilLaunch < 0 &&
        status !== "completed",
    },
  } as unknown as PlantFactSnapshot;
}

/**
 * A plant that shares everything and had nothing withheld — which is what every
 * pre-#480 classification test was implicitly about. Naming it keeps those
 * tests reading as "no elevated signals" rather than "no visibility".
 */
const FULLY_VISIBLE = { hasSharedContent: true, withheldCount: 0 };

// --- classification ---------------------------------------------------------

test("on-track: no elevated insights and no imminent launch", () => {
  const result = classifyPlantHealth(
    [insight("info"), insight("low")],
    snapshotWithLaunch(120),
    FULLY_VISIBLE
  );
  assert.equal(result, "on-track");
});

test("on-track when there is no snapshot and no insights", () => {
  assert.equal(classifyPlantHealth([], null, FULLY_VISIBLE), "on-track");
});

test("watch: a medium-severity network observation", () => {
  const result = classifyPlantHealth(
    [insight("low"), insight("medium")],
    snapshotWithLaunch(null),
    FULLY_VISIBLE
  );
  assert.equal(result, "watch");
});

test("readiness: a high-severity network observation", () => {
  const result = classifyPlantHealth(
    [insight("medium"), insight("high")],
    snapshotWithLaunch(null),
    FULLY_VISIBLE
  );
  assert.equal(result, "readiness");
});

test("readiness: a critical network observation", () => {
  assert.equal(
    classifyPlantHealth(
      [insight("critical")],
      snapshotWithLaunch(null),
      FULLY_VISIBLE
    ),
    "readiness"
  );
});

test("readiness when launch is within the window even with no insights", () => {
  const result = classifyPlantHealth(
    [],
    snapshotWithLaunch(READINESS_LAUNCH_WINDOW_DAYS),
    FULLY_VISIBLE
  );
  assert.equal(result, "readiness");
});

test("readiness when launch is past due", () => {
  assert.equal(
    classifyPlantHealth([], snapshotWithLaunch(-5), FULLY_VISIBLE),
    "readiness"
  );
});

test("a COMPLETED launch is not past due, however long ago it was", () => {
  // The bug this pins: the classifier thresholded `daysUntilLaunch <= 30` with
  // no lower bound, so a plant that launched successfully sat in `readiness` on
  // the oversight portfolio forever — the exact failure `buildLaunchSignals`
  // excludes completed launches from `isPastDue` to prevent.
  assert.equal(
    classifyPlantHealth([], snapshotWithLaunch(-5, "completed"), FULLY_VISIBLE),
    "on-track"
  );
  assert.equal(
    classifyPlantHealth(
      [],
      snapshotWithLaunch(-730, "completed"),
      FULLY_VISIBLE
    ),
    "on-track"
  );
});

test("a completed launch still escalates on the judge's own severities", () => {
  // The launch fact goes quiet; nothing else does. A high-severity network
  // observation about a launched plant is still a readiness conversation.
  assert.equal(
    classifyPlantHealth(
      [insight("high")],
      snapshotWithLaunch(-30, "completed"),
      FULLY_VISIBLE
    ),
    "readiness"
  );
  assert.equal(
    classifyPlantHealth(
      [insight("medium")],
      snapshotWithLaunch(-30, "completed"),
      FULLY_VISIBLE
    ),
    "watch"
  );
});

test("a snapshot too old to carry isPastDue does not fabricate one", () => {
  // `launch.isPastDue` is the ONE field consulted for "behind us". A stored
  // snapshot that predates it reports no overdue launch rather than having one
  // re-derived from the countdown, which is how the bug above was written.
  const legacy = {
    launch: { daysUntilLaunch: -5 },
  } as unknown as PlantFactSnapshot;
  assert.equal(classifyPlantHealth([], legacy, FULLY_VISIBLE), "on-track");
});

test("launch just outside the window does not force readiness", () => {
  const result = classifyPlantHealth(
    [],
    snapshotWithLaunch(READINESS_LAUNCH_WINDOW_DAYS + 1),
    FULLY_VISIBLE
  );
  assert.equal(result, "on-track");
});

test("readiness severity takes precedence over watch", () => {
  const result = classifyPlantHealth(
    [insight("medium"), insight("high")],
    snapshotWithLaunch(200),
    FULLY_VISIBLE
  );
  assert.equal(result, "readiness");
});

// --- privacy category mapping (AC-PE-9) ------------------------------------

test("people-derived categories gate on the people share toggle", () => {
  for (const category of [
    "vision_casting",
    "shared_ownership",
    "critical_mass",
    "generosity",
    "emerging_leadership",
    "follow_up",
  ]) {
    assert.equal(privacyFeatureForCategory(category), "people");
  }
});

test("launch_readiness gates on the meetings toggle", () => {
  assert.equal(privacyFeatureForCategory("launch_readiness"), "meetings");
});

test("comprehensive_training gates on the ministry_teams toggle", () => {
  assert.equal(
    privacyFeatureForCategory("comprehensive_training"),
    "ministry_teams"
  );
});

test("cross-cutting categories are not privacy-gated", () => {
  assert.equal(privacyFeatureForCategory("phase_progress"), null);
  assert.equal(privacyFeatureForCategory("onboarding"), null);
});

test("unknown categories fail closed to the people toggle", () => {
  assert.equal(privacyFeatureForCategory("totally_unknown"), "people");
});

// --- shared-content branch (AC-PE-9) ---------------------------------------

test("nothing visible and nothing shared reads as no shared content", () => {
  assert.equal(computeHasSharedContent([], []), false);
});

test("a shared feature counts even when the judge produced no insight", () => {
  // "Shared, nothing to report" must not render as "withheld".
  assert.equal(computeHasSharedContent([], [true]), true);
});

test("every consulted feature withheld reads as no shared content", () => {
  assert.equal(computeHasSharedContent([], [false, false]), false);
});

test("regression: an ungated insight is shared content on its own", () => {
  // `phase_progress` / `onboarding` map to no privacy feature, so `featureAllowed`
  // is empty for a plant whose only network insight is ungated. Before the fix
  // this returned false and the card suppressed an insight that passed gating.
  assert.equal(computeHasSharedContent([{ id: "i1" }], []), true);
});

test("regression: a visible insight wins over fully-withheld features", () => {
  // Mixed case: the people-gated insight was dropped, the ungated one survived.
  assert.equal(computeHasSharedContent([{ id: "i1" }], [false]), true);
});

// ----------------------------------------------------------------------------
// Silence is not health (#480, C11)
//
// Bryan: "I would not want absence of warning signs to accidentally look like
// an 'on track' signal." Before this, that was exactly the behaviour — the
// classifier is fed only the insights that survived privacy gating, so a fully
// private plant arrived as an empty array and fell through to `on-track`.
// ----------------------------------------------------------------------------

test("a plant sharing nothing reads limited-visibility, never on-track", () => {
  assert.equal(
    classifyPlantHealth([], snapshotWithLaunch(120), {
      hasSharedContent: false,
      withheldCount: 0,
    }),
    "limited-visibility"
  );
});

test("a partially-private plant with nothing elevated visible is limited too", () => {
  // It shares SOMETHING, and what it shares is quiet — but two observations
  // were removed by the gate, so "quiet" is not a claim anyone can make.
  assert.equal(
    classifyPlantHealth([insight("low")], snapshotWithLaunch(120), {
      hasSharedContent: true,
      withheldCount: 2,
    }),
    "limited-visibility"
  );
});

test("escalations win: a visible critical still reads readiness while gated", () => {
  // D1. What is on the screen is real. Hiding a genuine escalation behind "we
  // cannot see everything" would be a worse lie than the one #480 fixes.
  assert.equal(
    classifyPlantHealth([insight("critical")], snapshotWithLaunch(120), {
      hasSharedContent: true,
      withheldCount: 3,
    }),
    "readiness"
  );
});

test("escalations win: a visible medium still reads watch while gated", () => {
  assert.equal(
    classifyPlantHealth([insight("medium")], snapshotWithLaunch(null), {
      hasSharedContent: false,
      withheldCount: 1,
    }),
    "watch"
  );
});

test("an imminent launch still reads readiness on a fully private plant", () => {
  assert.equal(
    classifyPlantHealth([], snapshotWithLaunch(READINESS_LAUNCH_WINDOW_DAYS), {
      hasSharedContent: false,
      withheldCount: 0,
    }),
    "readiness"
  );
});

test("nothing withheld and something shared is still on-track", () => {
  // The posture has to remain reachable, or every plant in the portfolio would
  // read "limited visibility" and the word would stop meaning anything.
  assert.equal(
    classifyPlantHealth([insight("low")], snapshotWithLaunch(120), {
      hasSharedContent: true,
      withheldCount: 0,
    }),
    "on-track"
  );
});
