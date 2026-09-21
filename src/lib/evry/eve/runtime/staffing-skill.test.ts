import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { z } from "zod";

const skill = readFileSync("agent/skills/staffing-review/SKILL.md", "utf8");
const example = skill.match(
  /```js\n(function summarizeRequirementComparisons[\s\S]*?)\n```/
)?.[1];
assert.ok(
  example,
  "The tested helper must be the exact example delivered by the staffing skill"
);
const comparison = z.object({
  roleId: z.string(),
  personId: z.string(),
  requirementId: z.string(),
  state: z.enum(["met", "unmet", "unrecorded", "unknown", "not_applicable"]),
});
type Comparison = z.infer<typeof comparison>;
const summary = z.object({
  affectedRoleIds: z.array(z.string()),
  affectedRoleCount: z.number(),
  affectedPersonIds: z.array(z.string()),
  affected: z.array(comparison),
  unknown: z.array(comparison),
  comparedRoleCount: z.number(),
});
function summarize(rows: Comparison[]) {
  const result: unknown = runInNewContext(
    `${example}\nsummarizeRequirementComparisons(rows)`,
    { rows },
    { timeout: 1000 }
  );
  return summary.parse(result);
}

test("staffing example counts the one unmet role, not both background-check-required roles", () => {
  // Facts from roles-04: required/not started, required/cleared, custom/not required.
  const result = summarize([
    {
      roleId: "check-in",
      personId: "alex",
      requirementId: "background-check",
      state: "unmet",
    },
    {
      roleId: "room-helper",
      personId: "jordan",
      requirementId: "background-check",
      state: "met",
    },
    {
      roleId: "custom-hospitality",
      personId: "sam",
      requirementId: "background-check",
      state: "not_applicable",
    },
  ]);
  assert.deepEqual(result.affectedRoleIds, ["check-in"]);
  assert.equal(result.affectedRoleCount, 1);
  assert.deepEqual(result.affectedPersonIds, ["alex"]);
  assert.equal(result.comparedRoleCount, 3);
});

test("multiple people, repeated rows and multiple missing requirements count a role once", () => {
  const gap: Comparison = {
    roleId: "check-in",
    personId: "alex",
    requirementId: "background-check",
    state: "unmet",
  };
  const result = summarize([
    gap,
    gap,
    { ...gap, requirementId: "child-safety", state: "unrecorded" },
    { ...gap, personId: "sam" },
    { ...gap, roleId: "room-helper" },
  ]);
  assert.deepEqual(result.affectedRoleIds, ["check-in", "room-helper"]);
  assert.equal(result.affectedRoleCount, 2);
  assert.deepEqual(result.affectedPersonIds, ["alex", "sam"]);
  assert.equal(result.affected.length, 4);
});

test("unknown evidence does not become a missing completion or disappear behind a known gap", () => {
  const result = summarize([
    {
      roleId: "check-in",
      personId: "alex",
      requirementId: "background-check",
      state: "unknown",
    },
    {
      roleId: "check-in",
      personId: "alex",
      requirementId: "child-safety",
      state: "unrecorded",
    },
    {
      roleId: "room-helper",
      personId: "jordan",
      requirementId: "background-check",
      state: "unknown",
    },
  ]);
  assert.deepEqual(result.affectedRoleIds, ["check-in"]);
  assert.equal(result.unknown.length, 2);
  assert.equal(result.affected[0].state, "unrecorded");
});

test("satisfied and not-applicable requirements produce no affected roles", () => {
  const result = summarize([
    {
      roleId: "room-helper",
      personId: "jordan",
      requirementId: "background-check",
      state: "met",
    },
  ]);
  assert.equal(result.affectedRoleCount, 0);
  assert.deepEqual(result.affectedRoleIds, []);
});

test("conflicting requirement classifications cannot be silently counted", () => {
  const row: Comparison = {
    roleId: "check-in",
    personId: "alex",
    requirementId: "background-check",
    state: "met",
  };
  assert.throws(
    () => summarize([row, { ...row, state: "unmet" }]),
    /Conflicting requirement evidence/
  );
});

test("skill grounds classification in policy and scoped completion evidence", () => {
  assert.match(skill, /vacant: false/);
  assert.match(skill, /Background check required/);
  assert.match(skill, /missing or inaccessible person record is unknown/i);
  assert.match(skill, /No completion recorded/);
  assert.match(
    skill,
    /Missing pages, inaccessible records, or omitted fields are unknown/
  );
  assert.match(
    skill,
    /do not fetch contact details, notes or activity history/i
  );
  assert.match(skill, /authorized filtered read/);
});
