import assert from "node:assert/strict";
import { test } from "node:test";
import { observedLaunchStaffing } from "./launch-staffing";

const team = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
function teamRead(value = "2") {
  return {
    id: "team-read",
    name: "teams.query",
    input: {
      request: {
        resource: "teams",
        where: { all: [{ statuses: ["forming", "active"] }] },
      },
    },
    output: {
      kind: "read",
      resultMode: "list",
      counts: { matched: 1, returned: 1 },
      filters: [{ label: "Next page cursor", value: "End of results" }],
      items: [{ id: team, facts: [{ label: "Open role slots", value }] }],
    },
  };
}

test("complete team totals establish facts independent of filter wording", () => {
  assert.deepEqual(observedLaunchStaffing(teamRead()), [`${team}:2`]);
  assert.deepEqual(
    observedLaunchStaffing({
      ...teamRead(),
      input: { request: { resource: "teams" } },
    }),
    [`${team}:2`]
  );
  assert.deepEqual(observedLaunchStaffing(teamRead("0")), []);
});

test("truncated pages, duplicate identities and invalid totals establish no staffing fact", () => {
  for (const mutate of [
    (read: ReturnType<typeof teamRead>) => {
      read.output.counts.matched = 2;
    },
    (read: ReturnType<typeof teamRead>) => {
      read.output.counts.returned = 0;
    },
    (read: ReturnType<typeof teamRead>) => {
      read.output.filters[0]!.value = "1";
    },
    (read: ReturnType<typeof teamRead>) => {
      read.output.filters = [];
    },
    (read: ReturnType<typeof teamRead>) => {
      read.output.resultMode = "group";
    },
    (read: ReturnType<typeof teamRead>) => {
      read.output.items.push(read.output.items[0]!);
      read.output.counts = { matched: 2, returned: 2 };
    },
    (read: ReturnType<typeof teamRead>) => {
      read.output.items[0]!.facts.push({
        label: "Open role slots",
        value: "1",
      });
    },
  ]) {
    const read = teamRead();
    mutate(read);
    assert.equal(observedLaunchStaffing(read), null);
  }
  for (const value of ["-1", "unknown", "1.5", "9007199254740992"])
    assert.equal(observedLaunchStaffing(teamRead(value)), null);
});

test("exact team identities and totals distinguish missing, foreign or wrong staffing from truth", () => {
  const expected = [`${team}:2`, `${other}:1`].sort();
  assert.notDeepEqual(observedLaunchStaffing(teamRead()), expected);
  const wrongTeam = teamRead();
  wrongTeam.output.items[0]!.id = other;
  assert.notDeepEqual(observedLaunchStaffing(wrongTeam), [`${team}:2`]);
  assert.notDeepEqual(observedLaunchStaffing(teamRead("3")), [`${team}:2`]);
});

test("role rows derive equivalent team totals from actual vacancy evidence, not stored status", () => {
  const result = observedLaunchStaffing({
    ...teamRead(),
    input: { request: { resource: "roles" } },
    output: {
      ...teamRead().output,
      counts: { matched: 3, returned: 3 },
      items: ["1", "2", "3"].map((suffix) => ({
        id: `20000000-0000-4000-8000-00000000000${suffix}`,
        sourceLink: { href: `/teams/${team}` },
        facts: [
          { label: "Vacancy", value: suffix === "3" ? "Filled" : "Open" },
        ],
      })),
    },
  });
  assert.deepEqual(result, [`${team}:2`]);
  assert.equal(
    observedLaunchStaffing({ ...teamRead(), name: "tasks.query" }),
    null
  );
});

test("a complete narrower role search cannot contradict a whole-team vacancy total", () => {
  const roleRead = {
    ...teamRead(),
    input: {
      request: {
        resource: "roles",
        where: { all: [{ vacant: true, leadership: true }] },
      },
    },
    output: {
      ...teamRead().output,
      items: [
        {
          id: other,
          sourceLink: { href: `/teams/${team}` },
          facts: [{ label: "Vacancy", value: "Open" }],
        },
      ],
    },
  };
  assert.equal(observedLaunchStaffing(roleRead), null);
  assert.deepEqual(
    observedLaunchStaffing({
      ...roleRead,
      input: {
        request: {
          resource: "roles",
          where: { all: [{ vacant: true, teamIds: [team] }] },
        },
      },
    }),
    [`${team}:1`]
  );
  assert.equal(
    observedLaunchStaffing({
      ...roleRead,
      input: {
        request: {
          resource: "roles",
          where: { any: [{ vacant: true }, { leadership: true }] },
        },
      },
    }),
    null
  );
});
