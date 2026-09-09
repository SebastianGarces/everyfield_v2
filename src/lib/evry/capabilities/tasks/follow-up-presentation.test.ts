import assert from "node:assert/strict";
import test from "node:test";

import type {
  FollowUpContact,
  OpenFollowUpTask,
} from "@/lib/tasks/follow-up-ownership.shared";

import {
  followUpContactRows,
  FOLLOW_UP_CONTACT_CRITERIA,
  FOLLOW_UP_OWNER_CRITERIA,
} from "./follow-up-presentation";
import { FOLLOW_UP_STATUSES, STATUS_LABELS } from "@/lib/people/status.shared";

const contacts: FollowUpContact[] = [
  "owned",
  "unassigned",
  "no-task",
  "demoted",
].map((personId) => ({
  personId,
  name: `Person ${personId}`,
  status: "following_up",
  lastTouchedAt: new Date("2026-09-06T00:00:00Z"),
}));
const task: OpenFollowUpTask = {
  taskId: "task-1",
  title: "Call Alex",
  dueDate: null,
  contactId: "owned",
  assignedToId: "owner",
  ownerName: "Jordan Lee",
  ownerEmail: "jordan@example.test",
  ownerIsCommitted: true,
  ownerIsPlanter: false,
};
const tasks = [
  task,
  { ...task, taskId: "task-2", contactId: "unassigned", assignedToId: null },
  { ...task, taskId: "task-3", contactId: "demoted", ownerIsCommitted: false },
];

test("follow-up results show human labels and owner names without raw storage fields", () => {
  const rows = followUpContactRows(contacts, tasks, false);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0]?.facts, [
    { label: "Status", value: "Following Up" },
    { label: "Follow-up owner", value: "Jordan Lee" },
  ]);
  assert.doesNotMatch(
    JSON.stringify(rows),
    /following_up|2026-09-06|lastTouchedAt/
  );
});

test("unowned filter includes missing tasks and former owners, but excludes live-owned contacts", () => {
  const rows = followUpContactRows(contacts, tasks, true);
  assert.deepEqual(
    rows.map(({ id }) => id),
    ["unassigned", "no-task", "demoted"]
  );
  assert.ok(rows.every(({ facts }) => facts[1]?.value === "Needs owner"));
  assert.deepEqual(followUpContactRows([contacts[0]!], [task], true), []);
  for (const status of FOLLOW_UP_STATUSES) {
    assert.ok(FOLLOW_UP_CONTACT_CRITERIA.includes(STATUS_LABELS[status]));
  }
  assert.match(FOLLOW_UP_CONTACT_CRITERIA, /open task is not required/);
  assert.match(FOLLOW_UP_OWNER_CRITERIA, /people with no task/);
  assert.match(FOLLOW_UP_OWNER_CRITERIA, /separate totals/);
});

test("multiple follow-up tasks show each current owner once", () => {
  const rows = followUpContactRows(
    contacts,
    [
      task,
      { ...task, taskId: "other" },
      { ...task, taskId: "third", ownerName: "Sam Chen" },
    ],
    false
  );
  assert.equal(rows[0]?.facts[1]?.value, "Jordan Lee, Sam Chen");
});
