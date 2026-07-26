import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  PersonTeamAssignment,
  PersonTrainingItem,
} from "@/lib/ministry-teams/service";

import {
  formatMembershipStart,
  sortTeamAssignments,
  sortTrainingItems,
  summarizeTraining,
} from "./person-teams-presentation";

function training(
  overrides: Partial<PersonTrainingItem> & { programId: string }
): PersonTrainingItem {
  return {
    programName: overrides.programId,
    teamId: null,
    teamName: null,
    isRequired: false,
    completedAt: null,
    ...overrides,
  };
}

function assignment(
  overrides: Partial<PersonTeamAssignment> & { membershipId: string }
): PersonTeamAssignment {
  return {
    teamId: "team",
    teamName: "Worship",
    roleId: "role",
    roleName: "Vocalist",
    status: "active",
    startDate: null,
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// summarizeTraining — the "completed vs required" claim the card makes.
// ----------------------------------------------------------------------------

test("summarizeTraining counts completions against required programs", () => {
  const summary = summarizeTraining([
    training({
      programId: "safety",
      isRequired: true,
      completedAt: new Date("2026-01-05T00:00:00Z"),
    }),
    training({ programId: "doctrine", isRequired: true }),
    training({
      programId: "sound-desk",
      completedAt: new Date("2026-02-01T00:00:00Z"),
    }),
    training({ programId: "hospitality" }),
  ]);

  assert.deepEqual(summary, {
    total: 4,
    completed: 2,
    requiredTotal: 2,
    requiredCompleted: 1,
    percentComplete: 50,
  });
});

test("summarizeTraining falls back to all programs when none are required", () => {
  const summary = summarizeTraining([
    training({
      programId: "sound-desk",
      completedAt: new Date("2026-02-01T00:00:00Z"),
    }),
    training({ programId: "hospitality" }),
    training({ programId: "greeting" }),
  ]);

  assert.equal(summary.requiredTotal, 0);
  assert.equal(summary.completed, 1);
  assert.equal(summary.percentComplete, 33);
});

test("summarizeTraining reports zero progress for a person with no programs", () => {
  assert.deepEqual(summarizeTraining([]), {
    total: 0,
    completed: 0,
    requiredTotal: 0,
    requiredCompleted: 0,
    percentComplete: 0,
  });
});

test("summarizeTraining reports 100 percent once every required program is done", () => {
  const summary = summarizeTraining([
    training({
      programId: "safety",
      isRequired: true,
      completedAt: new Date("2026-01-05T00:00:00Z"),
    }),
    // An outstanding optional program must not drag the required bar below 100.
    training({ programId: "hospitality" }),
  ]);

  assert.equal(summary.percentComplete, 100);
});

// ----------------------------------------------------------------------------
// sortTrainingItems — outstanding required work has to surface first.
// ----------------------------------------------------------------------------

test("sortTrainingItems puts outstanding required work first and done work last", () => {
  const sorted = sortTrainingItems([
    training({
      programId: "done-required",
      programName: "A completed required",
      isRequired: true,
      completedAt: new Date("2026-01-05T00:00:00Z"),
    }),
    training({ programId: "optional", programName: "B optional" }),
    training({
      programId: "required",
      programName: "C required",
      isRequired: true,
    }),
  ]);

  assert.deepEqual(
    sorted.map((item) => item.programId),
    ["required", "optional", "done-required"]
  );
});

test("sortTrainingItems breaks ties by name and leaves the input untouched", () => {
  const input = [
    training({ programId: "b", programName: "Beta" }),
    training({ programId: "a", programName: "Alpha" }),
  ];

  assert.deepEqual(
    sortTrainingItems(input).map((item) => item.programId),
    ["a", "b"]
  );
  assert.deepEqual(
    input.map((item) => item.programId),
    ["b", "a"]
  );
});

// ----------------------------------------------------------------------------
// sortTeamAssignments
// ----------------------------------------------------------------------------

test("sortTeamAssignments orders by team, then role", () => {
  const sorted = sortTeamAssignments([
    assignment({
      membershipId: "2",
      teamName: "Worship",
      roleName: "Vocalist",
    }),
    assignment({
      membershipId: "1",
      teamName: "Worship",
      roleName: "Guitarist",
    }),
    assignment({
      membershipId: "3",
      teamName: "Hospitality",
      roleName: "Greeter",
    }),
  ]);

  assert.deepEqual(
    sorted.map((a) => a.membershipId),
    ["3", "1", "2"]
  );
});

// ----------------------------------------------------------------------------
// formatMembershipStart — a `date` column, not a timestamp.
// ----------------------------------------------------------------------------

test("formatMembershipStart renders the stored calendar day, timezone-free", () => {
  assert.equal(formatMembershipStart("2026-03-01"), "Mar 1, 2026");
  assert.equal(formatMembershipStart("2026-12-25"), "Dec 25, 2026");
});

test("formatMembershipStart returns null for missing or unparseable values", () => {
  assert.equal(formatMembershipStart(null), null);
  assert.equal(formatMembershipStart(""), null);
  assert.equal(formatMembershipStart("not-a-date"), null);
  assert.equal(formatMembershipStart("2026-13-01"), null);
});
