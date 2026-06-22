import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlantInsight } from "@/db/schema";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";

import {
  classifyPlantHealth,
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

function snapshotWithLaunch(daysUntilLaunch: number | null): PlantFactSnapshot {
  // Only `launch.daysUntilLaunch` is read by the classifier; cast a minimal shape.
  return {
    launch: { daysUntilLaunch },
  } as unknown as PlantFactSnapshot;
}

// --- classification ---------------------------------------------------------

test("on-track: no elevated insights and no imminent launch", () => {
  const result = classifyPlantHealth(
    [insight("info"), insight("low")],
    snapshotWithLaunch(120)
  );
  assert.equal(result, "on-track");
});

test("on-track when there is no snapshot and no insights", () => {
  assert.equal(classifyPlantHealth([], null), "on-track");
});

test("watch: a medium-severity network observation", () => {
  const result = classifyPlantHealth(
    [insight("low"), insight("medium")],
    snapshotWithLaunch(null)
  );
  assert.equal(result, "watch");
});

test("readiness: a high-severity network observation", () => {
  const result = classifyPlantHealth(
    [insight("medium"), insight("high")],
    snapshotWithLaunch(null)
  );
  assert.equal(result, "readiness");
});

test("readiness: a critical network observation", () => {
  assert.equal(
    classifyPlantHealth([insight("critical")], snapshotWithLaunch(null)),
    "readiness"
  );
});

test("readiness when launch is within the window even with no insights", () => {
  const result = classifyPlantHealth(
    [],
    snapshotWithLaunch(READINESS_LAUNCH_WINDOW_DAYS)
  );
  assert.equal(result, "readiness");
});

test("readiness when launch is past due", () => {
  assert.equal(classifyPlantHealth([], snapshotWithLaunch(-5)), "readiness");
});

test("launch just outside the window does not force readiness", () => {
  const result = classifyPlantHealth(
    [],
    snapshotWithLaunch(READINESS_LAUNCH_WINDOW_DAYS + 1)
  );
  assert.equal(result, "on-track");
});

test("readiness severity takes precedence over watch", () => {
  const result = classifyPlantHealth(
    [insight("medium"), insight("high")],
    snapshotWithLaunch(200)
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
