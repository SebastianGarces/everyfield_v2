import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { meetingReadDateTime } from "../src/lib/evry/reads/meeting-date-time";
import { buildEvryTestSnapshot } from "./evry-test-snapshot";
import {
  parseRecurrenceRule,
  nextRecurrenceDueDate,
} from "../src/lib/tasks/recurrence";
import {
  buildEvryTestFixtures,
  fixtureClock,
  fixtureId,
  EVRY_TEST_ACCOUNTS,
  EVRY_TEST_CHURCH_ID,
} from "./evry-test-fixtures";

test("QA identities stay stable and cannot be supplied through CLI input", () => {
  assert.equal(fixtureId("church"), EVRY_TEST_CHURCH_ID);
  assert.equal(
    new Set(EVRY_TEST_ACCOUNTS.map((account) => account.id)).size,
    3
  );
  for (const account of EVRY_TEST_ACCOUNTS) z.string().uuid().parse(account.id);
  assert.equal(EVRY_TEST_ACCOUNTS[0].email, "evry-test@everyfield.app");
});

test("relative fixtures use New York calendar days at UTC midnight and across DST", () => {
  const late = fixtureClock(new Date("2026-09-08T02:00:00Z"));
  assert.equal(late.today, "2026-09-07");
  assert.equal(late.day(1), "2026-09-08");
  const spring = fixtureClock(new Date("2026-03-07T17:00:00Z"));
  assert.equal(
    spring.at(1).getTime() - spring.at(0).getTime(),
    23 * 60 * 60 * 1000
  );
  const fall = fixtureClock(new Date("2026-10-31T16:00:00Z"));
  assert.equal(
    fall.at(1).getTime() - fall.at(0).getTime(),
    25 * 60 * 60 * 1000
  );
  assert.throws(() => fixtureClock(new Date("invalid")));
  assert.match(
    meetingReadDateTime(spring.wallClock(1), "America/New_York"),
    /6:00 PM EDT$/
  );
  assert.match(
    meetingReadDateTime(fall.wallClock(1), "America/New_York"),
    /6:00 PM EST$/
  );
});

test("same reference date compiles the same complete fixture without providers", () => {
  const at = new Date("2026-09-08T16:00:00Z");
  const first = buildEvryTestFixtures(at, null);
  assert.deepEqual(first, buildEvryTestFixtures(at, null));
  assert.equal(first.expected.ownerPendingDueToday, 2);
  assert.equal(first.expected.ownerPendingOverdue, 2);
  const tables = new Map(first.batches.map((batch) => [batch.table, batch]));
  for (const table of [
    "households",
    "persons",
    "tags",
    "person_tags",
    "skills_inventory",
    "interviews",
    "assessments",
    "commitments",
    "person_activities",
    "ministry_teams",
    "team_roles",
    "team_memberships",
    "team_responsibilities",
    "training_programs",
    "training_completions",
    "locations",
    "church_meetings",
    "meeting_attendance",
    "meeting_responses",
    "invitations",
    "meeting_checklist_items",
    "meeting_evaluations",
    "tasks",
    "task_dependencies",
    "launches",
    "launch_milestones",
    "launch_milestone_tasks",
    "launch_events",
    "message_templates",
    "communications",
    "communication_recipients",
    "wiki_articles",
    "wiki_bookmarks",
    "wiki_progress",
    "wiki_article_feedback",
    "phase_transitions",
    "phase_prompt_answers",
    "plant_signals",
    "planter_checkins",
    "notifications",
    "notification_deliveries",
    "notification_preferences",
  ]) {
    assert.ok(tables.get(table)?.count, `missing ${table}`);
  }
  assert.equal(tables.get("persons")?.count, 59);
  assert.equal(tables.get("church_meetings")?.count, 9);
  assert.equal(tables.get("ministry_teams")?.count, 10);
  assert.equal(
    tables.size,
    first.batches.length,
    "one batch per table for reversible ordering"
  );
  for (const batch of first.batches) {
    assert.equal(
      new Set(batch.ids).size,
      batch.count,
      `${batch.table} has duplicate or missing fixture ids`
    );
    assert.ok(!batch.table.startsWith("evry_"), "audit tables are never reset");
  }
  const later = buildEvryTestFixtures(new Date("2026-09-22T16:00:00Z"), null);
  assert.equal(later.today, "2026-09-22");
  assert.deepEqual(
    later.batches.map((batch) => batch.ids),
    first.batches.map((batch) => batch.ids)
  );
  assert.deepEqual(later.expected, first.expected);
  assert.equal(buildEvryTestSnapshot(first, at).isColdStart, false);
  const recurring = first.rows.tasks.filter((task) => task.isRecurring);
  assert.equal(recurring.length, 1);
  for (const task of recurring) {
    const rule = parseRecurrenceRule(task.recurrenceRule);
    assert.ok(rule);
    assert.equal(
      nextRecurrenceDueDate(rule, task.dueDate ?? null, first.today),
      "2026-09-17"
    );
  }
});
