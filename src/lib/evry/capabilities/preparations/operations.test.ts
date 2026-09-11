import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvryCapabilityConversationSelectionInput } from "../conversation";
import { OPERATIONS_MODEL_PREPARATIONS } from "./operations";
import {
  resolveOperationDate,
  resolveOperationDatetime,
} from "./operations-dates";
import { TASK_ACTION_CONTRACTS } from "../tasks/contracts";
import { MEETINGS_ACTION_CONTRACTS } from "../meetings/catalog";
import { TEAMS_EFFECT_IDENTITY_BY_OPERATION } from "../teams/effect-contracts";
import { createTaskEvryConversationContinuation } from "../tasks/conversation";
import { createMeetingsEvryConversationContinuation } from "../meetings/conversation";

const ID = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-11T02:00:00Z");
const ZONE = "America/New_York";
const input = {
  actor: { userId: ID, plantId: ID, seat: "owner" },
  conversation: { id: ID },
  userRequestKey: ID,
  literalUserText: "A natural request with no special command syntax",
  pageContext: null,
  requestPageContext: null,
  now: NOW,
} as unknown as EvryCapabilityConversationSelectionInput;
const contract = (id: string) => {
  const item = OPERATIONS_MODEL_PREPARATIONS.find((item) => item.id === id);
  assert(item, `Missing preparation: ${id}`);
  return item;
};

test("operations preparation contracts are unique and admit intent, never plan internals", () => {
  assert.equal(OPERATIONS_MODEL_PREPARATIONS.length, 66);
  assert.equal(
    new Set(OPERATIONS_MODEL_PREPARATIONS.map((item) => item.id)).size,
    66
  );
  for (const item of OPERATIONS_MODEL_PREPARATIONS) {
    assert.equal(
      item.inputSchema.safeParse({
        actorUserId: ID,
        before: {},
        after: {},
        fingerprint: "forged",
      }).success,
      false
    );
  }
  const create = contract(TASK_ACTION_CONTRACTS.createTaskAction.operationId);
  assert(
    create.inputSchema.safeParse({
      title: "Call Alex",
      dueDate: { kind: "relative", period: "today" },
    }).success
  );
  assert.equal(
    create.inputSchema.safeParse({ title: "Call Alex", dueDate: "2026-02-30" })
      .success,
    false
  );
  assert.equal(
    create.inputSchema.safeParse({ title: "Call Alex", timezone: "UTC" })
      .success,
    false
  );
  const team = contract(TEAMS_EFFECT_IDENTITY_BY_OPERATION.updateTeamAction);
  assert.equal(
    team.inputSchema.safeParse({ teamId: ID, description: null }).success,
    false
  );
  assert(team.inputSchema.safeParse({ teamId: ID, description: "" }).success);
  const meeting = contract(
    MEETINGS_ACTION_CONTRACTS.createMeetingAction.operationId
  );
  assert(
    meeting.inputSchema.safeParse({
      type: "orientation",
      datetime: {
        date: { kind: "relative", period: "tomorrow" },
        time: "10:00",
      },
    }).success
  );
  assert.equal(
    meeting.inputSchema.safeParse({
      type: "orientation",
      datetime: "2026-09-10T10:00Z",
    }).success,
    false
  );
});

test("relative calendar intent resolves from server instant in the church zone", () => {
  assert.equal(
    resolveOperationDate({ kind: "relative", period: "today" }, NOW, ZONE),
    "2026-09-10"
  );
  assert.equal(
    resolveOperationDate({ kind: "relative", period: "tomorrow" }, NOW, ZONE),
    "2026-09-11"
  );
  assert.equal(
    resolveOperationDatetime(
      { date: { kind: "relative", period: "today" }, time: "10:00" },
      NOW,
      ZONE
    ),
    "2026-09-10T10:00:00.000Z"
  );
});

test("typed task intent bypasses phrase routing but resolves date only after recovery", async () => {
  const calls: string[] = [];
  const continuation = createTaskEvryConversationContinuation(
    {
      async findPlanByRequestKey() {
        calls.push("recover");
        return null;
      },
      async readTimeZone() {
        calls.push("timezone");
        return ZONE;
      },
      async resolve({ selection }) {
        calls.push("resolve");
        assert.equal(selection.values.dueDate, "2026-09-10");
        return null;
      },
      async propose() {
        throw new Error("No authorized target to propose");
      },
    },
    {
      kind: "effect",
      exportName: "createTaskAction",
      values: {
        title: "Call Alex",
        dueDate: { kind: "relative", period: "today" },
      },
    }
  );
  await continuation.continue(input);
  assert.deepEqual(calls, ["recover", "timezone", "resolve"]);
});

test("typed meetings reject skipped and repeated local times before proposal", async () => {
  for (const datetime of ["2026-03-08T02:30", "2026-11-01T01:30"]) {
    const calls: string[] = [];
    const continuation = createMeetingsEvryConversationContinuation(
      {
        async recoverProposal() {
          calls.push("recover");
          return null;
        },
        async readTimeZone() {
          calls.push("timezone");
          return ZONE;
        },
        async resolveEffect() {
          throw new Error("Ambiguous local time must not resolve targets");
        },
        async proposeEffect() {
          throw new Error("Ambiguous local time must not propose");
        },
      },
      undefined,
      {
        kind: "effect",
        exportName: "createMeetingAction",
        values: { type: "orientation", datetime },
      }
    );
    const result = await continuation.continue(input);
    assert.match(result?.body ?? "", /skipped or repeated/);
    assert.deepEqual(calls, ["recover", "timezone"]);
  }
});

test("typed meeting intent pins the church wall clock after request recovery", async () => {
  const calls: string[] = [];
  const continuation = createMeetingsEvryConversationContinuation(
    {
      async recoverProposal() {
        calls.push("recover");
        return null;
      },
      async readTimeZone() {
        calls.push("timezone");
        return ZONE;
      },
      async resolveEffect({ selection }) {
        calls.push("resolve");
        assert.equal(selection.values.datetime, "2026-09-11T10:00:00.000Z");
        assert.equal(selection.values.timezone, ZONE);
        return null;
      },
      async proposeEffect() {
        throw new Error("No authorized target to propose");
      },
    },
    undefined,
    {
      kind: "effect",
      exportName: "createMeetingAction",
      values: {
        type: "orientation",
        datetime: {
          date: { kind: "relative", period: "tomorrow" },
          time: "10:00",
        },
      },
    }
  );
  await continuation.continue(input);
  assert.deepEqual(calls, ["recover", "timezone", "resolve"]);
});
