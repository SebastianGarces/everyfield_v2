import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlantInsight } from "@/db/schema";
import type { PlantHealthSummary } from "@/lib/phase-engine/oversight/read";

import {
  assessedAgoLabel,
  CLASSIFICATION_META,
  CLASSIFICATION_SCAN_ORDER,
  comparePlantsByNeed,
  emphasisForSeverity,
  groupPlantsByNeed,
  launchLabel,
  LIMITED_VISIBILITY_DETAIL,
  sortInsightsByUrgency,
} from "./health-presentation";

// ----------------------------------------------------------------------------
// Ordering is the whole point of this surface: an operator scanning a portfolio
// must meet the plants needing a conversation first. These tests pin that
// order, since a regression here is silent — the page still renders, it just
// stops answering the question it exists to answer.
// ----------------------------------------------------------------------------

function plant(overrides: Partial<PlantHealthSummary>): PlantHealthSummary {
  return {
    churchId: overrides.churchName ?? "id",
    churchName: "Plant",
    currentPhase: 1,
    classification: "on-track",
    insights: [],
    daysUntilLaunch: null,
    generatedAt: new Date("2026-07-20T00:00:00Z"),
    hasSharedContent: true,
    ...overrides,
  };
}

// --- plant ordering ---------------------------------------------------------

test("classification outranks every other ordering signal", () => {
  const onTrackLaunchingTomorrow = plant({
    churchName: "A",
    classification: "on-track",
    daysUntilLaunch: 1,
  });
  const readinessWithNoLaunchDate = plant({
    churchName: "Z",
    classification: "readiness",
    daysUntilLaunch: null,
  });

  assert.ok(
    comparePlantsByNeed(readinessWithNoLaunchDate, onTrackLaunchingTomorrow) < 0
  );
});

test("within a group, the soonest launch sorts first", () => {
  const soon = plant({
    churchName: "Z",
    classification: "watch",
    daysUntilLaunch: 12,
  });
  const later = plant({
    churchName: "A",
    classification: "watch",
    daysUntilLaunch: 300,
  });

  assert.ok(comparePlantsByNeed(soon, later) < 0);
});

test("a plant with no launch date sorts after plants that have one", () => {
  const dated = plant({
    churchName: "Z",
    classification: "watch",
    daysUntilLaunch: 400,
  });
  const undated = plant({
    churchName: "A",
    classification: "watch",
    daysUntilLaunch: null,
  });

  assert.ok(comparePlantsByNeed(undated, dated) > 0);
});

test("name breaks ties so the order is stable across renders", () => {
  const a = plant({
    churchName: "Anchor",
    classification: "watch",
    daysUntilLaunch: 30,
  });
  const b = plant({
    churchName: "Beacon",
    classification: "watch",
    daysUntilLaunch: 30,
  });

  assert.ok(comparePlantsByNeed(a, b) < 0);
  assert.ok(comparePlantsByNeed(b, a) > 0);
});

// --- grouping ---------------------------------------------------------------

test("groups render readiness, then watch, then on-track", () => {
  const groups = groupPlantsByNeed([
    plant({ churchName: "A", classification: "on-track" }),
    plant({ churchName: "B", classification: "readiness" }),
    plant({ churchName: "C", classification: "watch" }),
  ]);

  assert.deepEqual(
    groups.map((g) => g.classification),
    ["readiness", "watch", "on-track"]
  );
});

test("empty groups are dropped rather than rendered as a zero", () => {
  const groups = groupPlantsByNeed([
    plant({ churchName: "A", classification: "on-track" }),
  ]);

  assert.deepEqual(
    groups.map((g) => g.classification),
    ["on-track"]
  );
});

test("grouping does not mutate the caller's array", () => {
  const plants = [
    plant({ churchName: "B", classification: "watch", daysUntilLaunch: 90 }),
    plant({ churchName: "A", classification: "watch", daysUntilLaunch: 10 }),
  ];
  groupPlantsByNeed(plants);

  assert.deepEqual(
    plants.map((p) => p.churchName),
    ["B", "A"]
  );
});

test("every plant lands in exactly one group", () => {
  const plants = [
    plant({ churchName: "A", classification: "on-track" }),
    plant({ churchName: "B", classification: "readiness" }),
    plant({ churchName: "C", classification: "watch" }),
    plant({ churchName: "D", classification: "readiness" }),
  ];
  const grouped = groupPlantsByNeed(plants).flatMap((g) => g.plants);

  assert.equal(grouped.length, plants.length);
});

// --- insight ordering -------------------------------------------------------

function insight(
  severity: PlantInsight["severity"],
  rank: number
): Pick<PlantInsight, "severity" | "rank"> {
  return { severity, rank };
}

test("observations sort most urgent first, then by the judge's rank", () => {
  const sorted = sortInsightsByUrgency([
    insight("low", 0),
    insight("critical", 5),
    insight("high", 2),
    insight("high", 1),
    insight("medium", 0),
  ]);

  assert.deepEqual(
    sorted.map((i) => `${i.severity}:${i.rank}`),
    ["critical:5", "high:1", "high:2", "medium:0", "low:0"]
  );
});

test("sorting observations does not mutate the query result", () => {
  const insights = [insight("low", 0), insight("critical", 1)];
  sortInsightsByUrgency(insights);

  assert.equal(insights[0].severity, "low");
});

test("high and critical share one emphasis level; info and low share another", () => {
  assert.equal(emphasisForSeverity("critical"), "high");
  assert.equal(emphasisForSeverity("high"), "high");
  assert.equal(emphasisForSeverity("medium"), "medium");
  assert.equal(emphasisForSeverity("low"), "low");
  assert.equal(emphasisForSeverity("info"), "low");
});

// --- freshness and launch copy ----------------------------------------------

test("a plant that was never assessed has no freshness label at all", () => {
  // The card branches on this to avoid telling the operator that a plant which
  // has never been assessed has withheld something.
  assert.equal(assessedAgoLabel(null), null);
});

test("snapshot age reads in the operator's units", () => {
  const now = new Date("2026-07-25T12:00:00Z");

  assert.equal(
    assessedAgoLabel(new Date("2026-07-25T01:00:00Z"), now),
    "Assessed today"
  );
  assert.equal(
    assessedAgoLabel(new Date("2026-07-24T00:00:00Z"), now),
    "Assessed yesterday"
  );
  assert.equal(
    assessedAgoLabel(new Date("2026-07-20T12:00:00Z"), now),
    "Assessed 5 days ago"
  );
  assert.equal(
    assessedAgoLabel(new Date("2026-06-20T12:00:00Z"), now),
    "Assessed last month"
  );
});

test("a launch already past is never imminent", () => {
  // Otherwise every post-launch plant in the portfolio wears a warm highlight
  // on a date that is simply history.
  assert.equal(launchLabel(-1, 30)?.imminent, false);
  assert.equal(launchLabel(-42, 30)?.imminent, false);
  assert.equal(launchLabel(0, 30)?.imminent, true);
});

test("launch copy marks a launch inside the readiness window as imminent", () => {
  assert.deepEqual(launchLabel(17, 30), {
    text: "Launches in 17 days",
    imminent: true,
  });
  assert.deepEqual(launchLabel(499, 30), {
    text: "Launches in 499 days",
    imminent: false,
  });
});

test("launch copy handles today, tomorrow and past-due without odd phrasing", () => {
  assert.equal(launchLabel(0, 30)?.text, "Launches today");
  assert.equal(launchLabel(1, 30)?.text, "Launches tomorrow");
  assert.equal(launchLabel(-1, 30)?.text, "Launched yesterday");
  assert.equal(launchLabel(-12, 30)?.text, "Launched 12 days ago");
  assert.equal(launchLabel(null, 30), null);
});

// ----------------------------------------------------------------------------
// The fourth posture (#480, C11)
// ----------------------------------------------------------------------------

test("Limited visibility scans above On track, below the escalations", () => {
  // Not a fault, but the one group where the overseer's next move is a
  // conversation rather than nothing.
  assert.deepEqual(CLASSIFICATION_SCAN_ORDER, [
    "readiness",
    "watch",
    "limited-visibility",
    "on-track",
  ]);
});

test("the label names the overseer's view, not the plant", () => {
  const meta = CLASSIFICATION_META["limited-visibility"];
  assert.equal(meta.label, "Limited visibility");
  assert.match(meta.description, /has chosen not to share assessment data/);
  // Nothing in the vocabulary may read as a verdict about the plant.
  assert.doesNotMatch(meta.description, /risk|concern|problem|failing/i);
});

test("the detail line is Bryan's own wording, in one place", () => {
  assert.equal(
    LIMITED_VISIBILITY_DETAIL,
    "Plant has chosen not to share assessment data."
  );
});
