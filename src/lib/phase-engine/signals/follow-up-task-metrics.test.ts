import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeFollowUpTaskMetrics,
  computeContactFreshness,
  followUpTaskOutcomesQuery,
} from "./follow-up-task-metrics";
const createdAt = new Date("2026-09-01T00:00:00Z");
const asOf = new Date("2026-09-04T00:00:00Z");
test("48h completion excludes waiver, recent tasks and missing completion evidence", () => {
  assert.deepEqual(
    computeFollowUpTaskMetrics(
      [
        {
          status: "complete",
          createdAt,
          followUpMeetingId: "verified-meeting",
          followUpStartedAt: createdAt,
          completedAt: new Date("2026-09-03T00:00:00Z"),
        },
        {
          status: "complete",
          createdAt,
          followUpMeetingId: "verified-meeting",
          followUpStartedAt: createdAt,
          completedAt: new Date("2026-09-03T00:00:01Z"),
        },
        {
          status: "complete",
          createdAt,
          followUpMeetingId: "verified-meeting",
          followUpStartedAt: createdAt,
          completedAt: null,
        },
        {
          status: "not_started",
          createdAt,
          followUpMeetingId: "verified-meeting",
          followUpStartedAt: createdAt,
          completedAt: null,
        },
        {
          status: "no_longer_needed",
          createdAt,
          followUpMeetingId: "verified-meeting",
          followUpStartedAt: createdAt,
          completedAt: null,
        },
        {
          status: "complete",
          createdAt: new Date("2026-09-03T00:00:01Z"),
          followUpMeetingId: "verified-meeting",
          followUpStartedAt: new Date("2026-09-03T00:00:01Z"),
          completedAt: asOf,
        },
      ],
      asOf
    ),
    {
      taskMeasurableCount: 4,
      taskCompletedWithin48HoursCount: 1,
      taskWaivedCount: 1,
      taskUnmeasuredCount: 0,
    }
  );
});
test("no obligations retains zero denominator for Unknown", () => {
  assert.equal(computeFollowUpTaskMetrics([], asOf).taskMeasurableCount, 0);
});

test("late finalization still measures from the meeting; missing origin is unmeasured", () => {
  assert.deepEqual(
    computeFollowUpTaskMetrics(
      [
        {
          status: "complete",
          createdAt: new Date("2026-09-03T00:00:00Z"),
          followUpMeetingId: "verified-meeting",
          followUpStartedAt: createdAt,
          completedAt: new Date("2026-09-03T01:00:00Z"),
        },
        {
          status: "complete",
          createdAt,
          followUpMeetingId: "verified-meeting",
          followUpStartedAt: null,
          completedAt: new Date("2026-09-02T01:00:00Z"),
        },
      ],
      asOf
    ),
    {
      taskMeasurableCount: 1,
      taskCompletedWithin48HoursCount: 0,
      taskWaivedCount: 0,
      taskUnmeasuredCount: 1,
    }
  );
});

test("freshness ignores edits and unknown/future contacts; boundary is14elapsed days", () => {
  const now = new Date("2026-09-20T00:00:00Z");
  const editedOnly = { updatedAt: now };
  assert.deepEqual(
    computeContactFreshness(
      [
        editedOnly as { lastContactAt?: Date },
        { lastContactAt: null },
        { lastContactAt: new Date("2026-09-21T00:00:00Z") },
        { lastContactAt: new Date("2026-09-06T00:00:00Z") },
        { lastContactAt: new Date("2026-09-06T00:00:01Z") },
      ],
      now
    ),
    { contactMeasuredCount: 2, contactRecentCount: 1, contactUnknownCount: 3 }
  );
});

test("contact query scopes both tenant sides and excludes unsuccessful evidence", async () => {
  const { openFollowUpContactsQuery } = await import("./queries");
  const query = openFollowUpContactsQuery("alpha-church", asOf).toSQL();
  assert.ok(query.sql.includes("c.church_id"));
  assert.ok(query.sql.includes("r.church_id"));
  assert.match(query.sql, /'sent', 'logged'/);
  assert.match(query.sql, /'sent', 'delivered', 'opened', 'clicked'/);
  assert.ok(
    query.params.filter((value) => value === "alpha-church").length >= 3
  );
  assert.ok(query.params.includes(asOf.toISOString()));
});

test("a start timestamp alone or missing start never proves a generating meeting", () => {
  const result = computeFollowUpTaskMetrics(
    [
      {
        status: "complete",
        createdAt,
        followUpMeetingId: null,
        followUpStartedAt: createdAt,
        completedAt: asOf,
      },
      {
        status: "complete",
        createdAt,
        followUpMeetingId: "verified-meeting",
        followUpStartedAt: null,
        completedAt: asOf,
      },
      {
        status: "complete",
        createdAt,
        followUpMeetingId: null,
        followUpStartedAt: null,
        completedAt: asOf,
      },
    ],
    asOf
  );
  assert.equal(result.taskMeasurableCount, 0);
  assert.equal(result.taskCompletedWithin48HoursCount, 0);
  assert.equal(result.taskUnmeasuredCount, 3);
});
test("meeting provenance lookup explicitly scopes the joined meeting to the plant", () => {
  const query = followUpTaskOutcomesQuery("alpha-church").toSQL();
  assert.match(query.sql, /left join "church_meetings"/);
  assert.ok(
    query.sql.includes(
      '"tasks"."follow_up_meeting_id" = "church_meetings"."id"'
    )
  );
  assert.ok(query.sql.includes('"church_meetings"."church_id"'));
  assert.equal(
    query.params.filter((value) => value === "alpha-church").length,
    2
  );
});
