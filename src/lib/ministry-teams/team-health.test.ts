import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeTeamHealth,
  countAttendedByMembers,
} from "@/lib/ministry-teams/health";

// ----------------------------------------------------------------------------
// Ruling 409-4A (2026-08-12) — the attendance numerator counts ONLY the team's
// active members. The denominator (members × recent meetings) is unchanged.
//
// Before the ruling, every 'attended' row on the team's last meetings counted,
// including guests who are not members of the team: a well-attended open
// meeting inflated a badly-staffed team's health score, and the percentage
// could exceed 100. These tests pin the restricted numerator and the ceiling.
// ----------------------------------------------------------------------------

const baseInputs = {
  teamId: "team-1",
  teamName: "Worship",
  staffing: { filled: 3, total: 4 },
  requiredProgramCount: 0,
  completedCount: 0,
};

test("countAttendedByMembers ignores attendance rows from non-members", () => {
  const rows = [
    { personId: "member-a", status: "attended" },
    { personId: "member-b", status: "attended" },
    { personId: "guest-1", status: "attended" },
    { personId: "guest-2", status: "attended" },
    { personId: "member-a", status: "absent" },
  ];

  assert.equal(countAttendedByMembers(rows, ["member-a", "member-b"]), 2);
});

test("countAttendedByMembers counts only 'attended' rows, even for members", () => {
  const rows = [
    { personId: "member-a", status: "absent" },
    { personId: "member-a", status: "excused" },
  ];

  assert.equal(countAttendedByMembers(rows, ["member-a"]), 0);
});

test("a duplicated member id (one person, two roles) does not double-count", () => {
  const rows = [{ personId: "member-a", status: "attended" }];

  // memberCount uses membership ROWS, so a person filling two roles appears
  // twice in the id list. The numerator must still count their row once.
  assert.equal(
    countAttendedByMembers(rows, ["member-a", "member-a", "member-b"]),
    1
  );
});

test("guests at an open meeting no longer push attendance past 100%", () => {
  // 2 members × 2 meetings = 4 expected. Both members attended both meetings,
  // and 6 guests came too. Before 409-4A this read 10/4 = 250%.
  const rows = [
    { personId: "member-a", status: "attended" },
    { personId: "member-b", status: "attended" },
    { personId: "member-a", status: "attended" },
    { personId: "member-b", status: "attended" },
    ...Array.from({ length: 6 }, (_, i) => ({
      personId: `guest-${i}`,
      status: "attended",
    })),
  ];

  const attendedCount = countAttendedByMembers(rows, ["member-a", "member-b"]);
  assert.equal(attendedCount, 4);

  const health = computeTeamHealth({
    ...baseInputs,
    memberCount: 2,
    recentMeetingCount: 2,
    attendedCount,
  });

  assert.equal(health.meetingAttendancePercent, 100);
});

test("the true (lower) rate is reported once guests are excluded", () => {
  // 2 members × 2 meetings = 4 expected; only one member came to one meeting,
  // alongside 5 guests. Before 409-4A this read 6/4 = 150%; the true value is
  // 1/4 = 25%.
  const rows = [
    { personId: "member-a", status: "attended" },
    ...Array.from({ length: 5 }, (_, i) => ({
      personId: `guest-${i}`,
      status: "attended",
    })),
  ];

  const attendedCount = countAttendedByMembers(rows, ["member-a", "member-b"]);
  assert.equal(attendedCount, 1);

  const health = computeTeamHealth({
    ...baseInputs,
    memberCount: 2,
    recentMeetingCount: 2,
    attendedCount,
  });

  assert.equal(health.meetingAttendancePercent, 25);
});

test("no meetings in the window still reads 100 — nothing was expected", () => {
  const health = computeTeamHealth({
    ...baseInputs,
    memberCount: 3,
    recentMeetingCount: 0,
    attendedCount: 0,
  });

  assert.equal(health.meetingAttendancePercent, 100);
});
