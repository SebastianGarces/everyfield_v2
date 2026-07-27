import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type {
  PersonTeamAssignment,
  PersonTrainingItem,
} from "@/lib/ministry-teams/service";

import {
  formatCalendarDate,
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
// formatCalendarDate — one formatter for both a `date` column (membership
// start) and a `timestamp` (training completion).
// ----------------------------------------------------------------------------

/**
 * Run `fn` with the process pinned to a timezone, so "does this shift the
 * calendar day" means the same thing on a laptop in Texas and in CI's UTC
 * container. Node re-reads `process.env.TZ` on the next `Date` call.
 */
function inTimezone<T>(timeZone: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test("formatCalendarDate renders the stored calendar day, timezone-free", () => {
  assert.equal(formatCalendarDate("2026-03-01"), "Mar 1, 2026");
  assert.equal(formatCalendarDate("2026-12-25"), "Dec 25, 2026");
});

test("formatCalendarDate reads a date column the same way in any timezone", () => {
  // UTC+14 and UTC-11 — the widest pair a `Date` round-trip could split.
  for (const zone of ["Pacific/Kiritimati", "Pacific/Niue"]) {
    inTimezone(zone, () => {
      assert.equal(formatCalendarDate("2026-03-01"), "Mar 1, 2026");
    });
  }
});

test("formatCalendarDate returns null for missing or unparseable values", () => {
  assert.equal(formatCalendarDate(null), null);
  assert.equal(formatCalendarDate(undefined), null);
  assert.equal(formatCalendarDate(""), null);
  assert.equal(formatCalendarDate("not-a-date"), null);
  assert.equal(formatCalendarDate("2026-13-01"), null);
  assert.equal(formatCalendarDate(new Date("not-a-date")), null);
});

test("formatCalendarDate renders a completion's local day west of Greenwich", () => {
  inTimezone("America/Chicago", () => {
    // 23:30 on Mar 1 in Chicago is already Mar 2 in UTC. The old
    // `completedAt.toISOString().slice(0, 10)` rendered "Mar 2, 2026".
    const completedAt = new Date("2026-03-02T05:30:00Z");

    assert.equal(completedAt.toISOString().slice(0, 10), "2026-03-02");
    assert.equal(completedAt.getHours(), 23);
    assert.equal(formatCalendarDate(completedAt), "Mar 1, 2026");
  });
});

test("formatCalendarDate renders a completion's local day east of Greenwich", () => {
  inTimezone("Asia/Tokyo", () => {
    // The mirror image: 00:30 on Mar 2 in Tokyo is still Mar 1 in UTC, so
    // pinning to UTC showed the day *early*.
    const completedAt = new Date("2026-03-01T15:30:00Z");

    assert.equal(completedAt.toISOString().slice(0, 10), "2026-03-01");
    assert.equal(formatCalendarDate(completedAt), "Mar 2, 2026");
  });
});

// ----------------------------------------------------------------------------
// Guard: the UTC-pinning idiom must not come back anywhere in this folder.
// ----------------------------------------------------------------------------

test("no people component pins a calendar day to UTC via toISOString().slice", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const offenders = readdirSync(dir)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .filter((name) =>
      /toISOString\(\)\s*\.\s*slice/.test(
        readFileSync(path.join(dir, name), "utf8")
      )
    );

  assert.deepEqual(
    offenders,
    [],
    `Use formatCalendarDate instead of toISOString().slice: ${offenders.join(", ")}`
  );
});
