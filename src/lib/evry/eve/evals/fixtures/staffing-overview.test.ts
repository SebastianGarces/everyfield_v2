import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import type { CapturedCall } from "./host-capture";
import {
  staffingOverviewFixtureIds,
  observedStaffingOverviewFacts,
} from "./staffing-overview";
const teamA = "10000000-0000-4000-8000-000000000001",
  teamB = "10000000-0000-4000-8000-000000000002";
const item = (
  id: string,
  fields: Record<string, string>,
  team = teamA,
  label = id
) => ({
  id,
  label,
  facts: Object.entries(fields).map(([label, value]) => ({ label, value })),
  sourceLink: { href: `/teams/${team}` },
});
const call = (
  resource: string,
  items: ReturnType<typeof item>[],
  total = items.length
): CapturedCall => ({
  id: `call-${resource}`,
  name: "teams.query",
  input: { request: { resource, query: { mode: "list", limit: 50 } } },
  output: {
    kind: "read",
    counts: { matched: total },
    filters: [{ label: "Next page cursor", value: "End of results" }],
    items,
  },
});
test("all eight staffing questions retain original requirements including missing data limits", () => {
  assert.deepEqual(
    staffingOverviewFixtureIds.map(
      (id) => questions.find((q) => q.id === id)?.turns[0]
    ),
    [
      "Which ministries are understaffed, and by how many people?",
      "Who serves on more than one ministry team?",
      "Show active teams with no assigned leader.",
      "Compare the children's and hospitality ministry rosters and training gaps.",
      "Which ministry responsibilities have nobody assigned?",
      "Find people with audio skills who are not already assigned to worship.",
      "Which background checks expire next month?",
      "Which volunteers have unfinished training and an assigned task due before the next meeting?",
    ]
  );
});
test("vacancies use open role slots, never assignments or unique volunteer counts", () => {
  const read = call("teams", [
    item(teamA, {
      "Open role slots": "2",
      "Distinct active people": "1",
      "Role slots": "4",
    }),
    item(teamB, {
      "Open role slots": "0",
      "Distinct active people": "2",
      "Role slots": "3",
    }),
  ]);
  assert.deepEqual(observedStaffingOverviewFacts("teams-01", [read]).facts, {
    openSlotsByTeam: [`${teamA}:2`],
  });
  assert.deepEqual(
    observedStaffingOverviewFacts("teams-01", [read], new Set([read.id])),
    observedStaffingOverviewFacts("teams-01", [read])
  );
});
test("two roles in one team do not make a multi-team volunteer; inactive rows do not count", () => {
  const read = call("assignments", [
    item("a1", { "Person ID": "alex", Status: "Active" }),
    item("a2", { "Person ID": "alex", Status: "Active" }),
    item("j1", { "Person ID": "jordan", Status: "Active" }),
    item("j2", { "Person ID": "jordan", Status: "Active" }, teamB),
    item("a3", { "Person ID": "alex", Status: "Inactive" }, teamB),
  ]);
  assert.deepEqual(observedStaffingOverviewFacts("teams-02", [read]).facts, {
    multiTeamPeople: ["jordan"],
  });
  assert.deepEqual(
    observedStaffingOverviewFacts("teams-02", [
      call("assignments", [item("a", { Status: "Active" })]),
    ]).facts,
    {}
  );
});
test("leaderless uses active team leader evidence, not vacant roles", () => {
  const read = call("teams", [
    item(teamA, {
      Status: "Active",
      Leader: "Not recorded",
      "Open role slots": "0",
    }),
    item(teamB, { Status: "Active", Leader: "Alex", "Open role slots": "2" }),
    item("paused", { Status: "Paused", Leader: "Not recorded" }),
  ]);
  assert.deepEqual(observedStaffingOverviewFacts("teams-03", [read]).facts, {
    leaderlessTeamIds: [teamA],
  });
});
test("incomplete responsibilities establish completion evidence only, not ownership", () => {
  const read = call("responsibilities", [
    item("open", { "Completed at": "Not recorded" }),
    item("done", { "Completed at": "Sep 19, 2026" }),
  ]);
  assert.deepEqual(observedStaffingOverviewFacts("teams-05", [read]).facts, {
    responsibilityIds: ["open"],
    completionStates: ["open:Not recorded"],
  });
});
test("partial or fresh failed reads cannot reuse older full evidence", () => {
  const full = call("teams", [item(teamA, { "Open role slots": "2" })]);
  assert.deepEqual(
    observedStaffingOverviewFacts("teams-01", [full, call("teams", [], 1)])
      .facts,
    {}
  );
  assert.deepEqual(
    observedStaffingOverviewFacts("teams-01", [
      full,
      { ...full, output: { status: "unavailable" } },
    ]).facts,
    {}
  );
});
test("background statuses never manufacture expiry dates", () => {
  const read = {
    ...call("", [item("alex", { "Background check": "Cleared" })]),
    name: "people.get_many",
    input: { resource: "person", ids: ["alex"], fields: ["background_check"] },
  };
  assert.deepEqual(observedStaffingOverviewFacts("training-04", [read]).facts, {
    backgroundStatuses: ["alex:Cleared"],
  });
  assert.ok(
    !JSON.stringify(
      observedStaffingOverviewFacts("training-04", [read]).facts
    ).includes("expir")
  );
});

test("coherent pagination requires contiguous distinct rows and a terminal cursor", () => {
  const first = call("teams", [item(teamA, { "Open role slots": "2" })], 2);
  first.output = {
    ...(first.output as object),
    filters: [{ label: "Next page cursor", value: "1" }],
  };
  const second = call("teams", [item(teamB, { "Open role slots": "1" })], 2);
  second.input = {
    request: {
      resource: "teams",
      query: { mode: "list", limit: 50, cursor: "1" },
    },
  };
  assert.deepEqual(
    observedStaffingOverviewFacts("teams-01", [first, second]).facts,
    { openSlotsByTeam: [`${teamA}:2`, `${teamB}:1`] }
  );
  assert.deepEqual(
    observedStaffingOverviewFacts("teams-01", [first]).facts,
    {}
  );
  const unfinished = {
    ...second,
    output: {
      ...(second.output as object),
      filters: [{ label: "Next page cursor", value: "2" }],
    },
  };
  assert.deepEqual(
    observedStaffingOverviewFacts("teams-01", [first, unfinished]).facts,
    {}
  );
});
test("training comparison joins the program to the correct team and deduplicates role rows", () => {
  const teams = call("teams", [
    item(teamA, {}, teamA, "Children's Ministry"),
    item(teamB, {}, teamB, "Hospitality"),
  ]);
  const roster = call("assignments", [
    item("a1", { "Person ID": "alex", Status: "Active" }),
    item("a2", { "Person ID": "alex", Status: "Active" }),
    item("a3", { "Person ID": "alex", Status: "Active" }, teamB),
  ]);
  const programs = {
    ...call("programs", [
      item("global", { Ministry: "All ministries" }),
      item("child", { Ministry: "Children's Ministry" }),
    ]),
    name: "training.query",
  };
  const gaps = {
    ...call("requirements", [
      item("alex:global", {
        "Person ID": "alex",
        "Training program ID": "global",
        Completion: "No completion recorded",
      }),
      item("alex:child", {
        "Person ID": "alex",
        "Training program ID": "child",
        Completion: "No completion recorded",
      }),
    ]),
    name: "training.query",
  };
  assert.deepEqual(
    observedStaffingOverviewFacts("teams-04", [teams, roster, programs, gaps])
      .facts,
    {
      comparedTeamIds: [teamA, teamB],
      rosterPairs: [`${teamA}:alex`, `${teamB}:alex`],
      trainingGaps: [
        `${teamA}:alex:child`,
        `${teamA}:alex:global`,
        `${teamB}:alex:global`,
      ],
    }
  );
});

test("cross-module task ownership requires the recorded account/person link and excludes meeting-day tasks", () => {
  const meetings = {
    ...call("", [
      item("next", {
        Status: "Planning",
        "Local start": "2026-09-21 10:00:00",
      }),
    ]),
    name: "meetings.query",
    input: { query: { mode: "list", limit: 50 } },
  };
  const gaps = {
    ...call("requirements", [
      item("gap", {
        "Person ID": "alex",
        Completion: "No completion recorded",
      }),
    ]),
    name: "training.query",
  };
  const accounts = {
    ...call("", [
      item("account", { "Account ID": "user-alex", "Person ID": "alex" }),
      item("collision", { "Account ID": "alex" }),
    ]),
    name: "tasks.assignees.search",
    input: { limit: 50 },
  };
  const tasks = {
    ...call("", [
      item("before", {
        "Assignee account ID": "user-alex",
        "Due date": "Sep 20, 2026",
        Status: "In Progress",
      }),
      item("at", {
        "Assignee account ID": "user-alex",
        "Due date": "Sep 21, 2026",
        Status: "Not Started",
      }),
      item("done", {
        "Assignee account ID": "user-alex",
        "Due date": "Sep 20, 2026",
        Status: "Complete",
      }),
      item("collision", {
        "Assignee account ID": "alex",
        "Due date": "Sep 20, 2026",
        Status: "Not Started",
      }),
    ]),
    name: "tasks.query",
    input: { query: { mode: "list", limit: 50 } },
  };
  assert.deepEqual(
    observedStaffingOverviewFacts("cross-03", [meetings, gaps, accounts, tasks])
      .facts,
    {
      nextMeetingId: "next",
      taskPersonPairs: ["before:alex:user-alex"],
      volunteerIds: ["alex"],
    }
  );
  assert.deepEqual(
    observedStaffingOverviewFacts("cross-03", [meetings, gaps, tasks]).facts,
    {}
  );
});
