import assert from "node:assert/strict";
import { test } from "node:test";

import { TEAMS_EFFECT_OPERATIONS } from "./effect-contracts";
import { selectTeamsEvryRequest, TEAMS_EFFECT_COMMANDS } from "./selection";

test("every Teams effect has one closed selection fixture", () => {
  const commands = Object.entries(TEAMS_EFFECT_COMMANDS);
  assert.deepEqual(
    commands.map(([, operation]) => operation).toSorted(),
    [...TEAMS_EFFECT_OPERATIONS].toSorted()
  );
  for (const [command, operation] of commands) {
    assert.deepEqual(selectTeamsEvryRequest(`teams ${command}`), {
      kind: "effect",
      operation,
      values: {},
    });
  }
});

test("classifier normalization never mutates user-authored graphemes", () => {
  const title = `ﬃ ① Ｆｕｌｌｗｉｄｔｈ ${"👨‍👩‍👧‍👦".repeat(700)}`;
  const selected = selectTeamsEvryRequest(
    `ｔｅａｍｓ create-responsibility | teamId=00000000-0000-4000-8000-000000000001|title=${title}`
  );
  assert.equal(selected?.kind, "effect");
  if (selected?.kind === "effect") assert.equal(selected.values.title, title);
});

test("JSON field syntax keeps every legal payload code unit", () => {
  const description = `  literal | equals = slash \\ ${"👨‍👩‍👧‍👦".repeat(700)}  `;
  const selected = selectTeamsEvryRequest(
    `ｔｅａｍｓ create-team | ${JSON.stringify({ name: "Exact", description })}`
  );
  assert.equal(selected?.kind, "effect");
  if (selected?.kind === "effect") {
    assert.equal(selected.values.description, description);
  }
});

test("unknown commands, fields, and malformed target IDs are refused", () => {
  assert.equal(
    selectTeamsEvryRequest("teams arbitrary-sql | query=delete"),
    null
  );
  assert.equal(
    selectTeamsEvryRequest("teams create-team | churchId=foreign"),
    null
  );
  assert.equal(selectTeamsEvryRequest("review ministry team not-a-uuid"), null);
  assert.equal(
    selectTeamsEvryRequest(
      "teams create-meeting | teamId=00000000-0000-4000-8000-000000000001|datetime=2031-02-03T18:30|timezone=America/New_York"
    ),
    null,
    "the owning meeting action accepts no request-controlled timezone"
  );
});

test("person team assignments and training have closed read selections", () => {
  const personId = "40000000-0000-4000-8000-000000000001";
  assert.deepEqual(
    selectTeamsEvryRequest(
      `review ministry team assignments for person ${personId}`
    ),
    { kind: "read_person_assignments", personId }
  );
  assert.deepEqual(
    selectTeamsEvryRequest(`review ministry training for person ${personId}`),
    { kind: "read_person_training", personId }
  );
});

test("the canonical role-description clear remains expressible", () => {
  const selected = selectTeamsEvryRequest(
    "teams update-role | roleId=00000000-0000-4000-8000-000000000001|description="
  );
  assert.equal(selected?.kind, "effect");
  if (selected?.kind === "effect")
    assert.equal(selected.values.description, "");
  const teamClear = selectTeamsEvryRequest(
    `teams update-team | ${JSON.stringify({
      teamId: "00000000-0000-4000-8000-000000000001",
      description: "",
      icon: "",
    })}`
  );
  assert.equal(teamClear?.kind, "effect");
  if (teamClear?.kind === "effect") {
    assert.equal(teamClear.values.description, "");
    assert.equal(teamClear.values.icon, "");
  }
  assert.equal(selectTeamsEvryRequest("teams create-team | name="), null);
});
