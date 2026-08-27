import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { FeedbackStatus } from "@/db/schema";
import { parseElements } from "@/lib/testing/rendered-markup";

import {
  FEEDBACK_STATUS_ACCESSIBLE_NAME_MAX_LENGTH,
  FEEDBACK_STATUS_SUBMITTER_MAX_LENGTH,
  feedbackStatusSelectAccessibleName,
  feedbackStatusSubmitter,
} from "./feedback-status-select-label";
import { FeedbackStatusSelectControl } from "./feedback-status-select-control";
import { submitFeedbackStatusChange } from "./feedback-status-select-workflow";

// The table's description is confidential feedback content. It must never be
// reused as a control name, even when it is the most convenient way to make
// two rendered rows look different.
type FeedbackRowFixture = {
  id: string;
  status: FeedbackStatus;
  category: string;
  submitter: string;
  submittedAt: string;
  description: string;
};

const ROWS: FeedbackRowFixture[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    status: "new",
    category: "bug",
    submitter: "Ada Lovelace",
    submittedAt: "Aug 26, 2026, 9:15 AM",
    description: "The invite flow stalls after I choose a church.",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    status: "reviewed",
    category: "suggestion",
    submitter: "Grace Hopper",
    submittedAt: "Aug 26, 2026, 10:45 AM",
    description: "Please add a place to capture follow-up notes.",
  },
];

function nameFor(row: FeedbackRowFixture) {
  return feedbackStatusSelectAccessibleName({
    id: row.id,
    category: row.category,
    submitter: row.submitter,
    submittedAt: row.submittedAt,
  });
}

function render(rows: FeedbackRowFixture[]) {
  return renderToStaticMarkup(
    createElement(
      "div",
      null,
      rows.map((row) =>
        createElement(FeedbackStatusSelectControl, {
          key: row.id,
          status: row.status,
          accessibleName: nameFor(row),
          isPending: false,
          onValueChange: () => {},
        })
      )
    )
  );
}

function statusControls(html: string) {
  return parseElements(html).filter(
    (element) =>
      element.tag === "button" &&
      element.attrs["data-slot"] === "select-trigger"
  );
}

test("every feedback status control has a distinct row-specific name", () => {
  const controls = statusControls(render(ROWS));

  assert.equal(controls.length, ROWS.length);
  assert.deepEqual(
    controls.map((control) => control.attrs["aria-label"]),
    ROWS.map(nameFor)
  );
  assert.equal(
    new Set(controls.map((control) => control.attrs["aria-label"])).size,
    ROWS.length,
    "two feedback rows must not expose identical Status controls"
  );
});

test("otherwise identical feedback rows retain their full UUID discriminator", () => {
  const rows = [
    {
      ...ROWS[0],
      id: "33333333-3333-4333-8333-333333333333",
    },
    {
      ...ROWS[0],
      id: "44444444-4444-4444-8444-444444444444",
    },
  ];
  const controls = statusControls(render(rows));

  assert.deepEqual(
    controls.map((control) => control.attrs["aria-label"]),
    rows.map(nameFor)
  );
  assert.notEqual(
    controls[0].attrs["aria-label"],
    controls[1].attrs["aria-label"]
  );
  for (const row of rows) {
    assert.ok(
      nameFor(row).includes(row.id),
      "the full feedback UUID must stay before the bounded summary"
    );
  }
});

test("the name is bounded and never repeats the feedback description", () => {
  const longMessage = "private feedback ".repeat(100);
  const longSubmitter = "A".repeat(FEEDBACK_STATUS_SUBMITTER_MAX_LENGTH + 40);
  const row: FeedbackRowFixture = {
    ...ROWS[0],
    submitter: longSubmitter,
    submittedAt: "A".repeat(FEEDBACK_STATUS_ACCESSIBLE_NAME_MAX_LENGTH),
    description: longMessage,
  };

  const name = nameFor(row);

  assert.ok(name.startsWith(`Status for bug feedback ${row.id}, from `));
  assert.ok(name.includes("…"), "long row context should be truncated");
  assert.ok(
    name.length <= FEEDBACK_STATUS_ACCESSIBLE_NAME_MAX_LENGTH,
    "the accessible name must stay bounded even when a row field is long"
  );
  assert.equal(
    name.includes(longMessage),
    false,
    "the full confidential feedback message must not enter the accessible name"
  );
});

test("a missing submitter name falls back to the existing row email", () => {
  assert.equal(
    feedbackStatusSubmitter(null, "nameless.planter@example.test"),
    "nameless.planter@example.test"
  );
  assert.equal(
    feedbackStatusSubmitter("", "nameless.planter@example.test"),
    "nameless.planter@example.test"
  );
});

test("the control forwards its current value, callback, and pending state", () => {
  const onValueChange = () => {};
  const control = FeedbackStatusSelectControl({
    status: "reviewed",
    accessibleName: nameFor(ROWS[0]),
    isPending: true,
    onValueChange,
  }) as ReactElement<{
    value: FeedbackStatus;
    disabled: boolean;
    onValueChange: typeof onValueChange;
  }>;

  assert.equal(control.props.value, "reviewed");
  assert.equal(control.props.disabled, true);
  assert.equal(control.props.onValueChange, onValueChange);
});

test("a status change forwards the row id and status, then reports success", async () => {
  let submitted: FormData | undefined;
  let successCount = 0;
  let errorMessage: string | undefined;

  await submitFeedbackStatusChange({
    id: ROWS[0].id,
    status: "new",
    next: "reviewed",
    updateStatus: async (formData) => {
      submitted = formData;
      return { success: true };
    },
    onSuccess: () => {
      successCount += 1;
    },
    onError: (message) => {
      errorMessage = message;
    },
  });

  assert.equal(submitted?.get("id"), ROWS[0].id);
  assert.equal(submitted?.get("status"), "reviewed");
  assert.equal(successCount, 1);
  assert.equal(errorMessage, undefined);
});

test("selecting the current status is a no-op and failures report their action error", async () => {
  let updateCalls = 0;
  let successCount = 0;
  const errors: string[] = [];
  const options = {
    id: ROWS[0].id,
    status: "new",
    updateStatus: async () => {
      updateCalls += 1;
      return { success: false as const, error: "Unable to save status." };
    },
    onSuccess: () => {
      successCount += 1;
    },
    onError: (message: string) => {
      errors.push(message);
    },
  };

  await submitFeedbackStatusChange({ ...options, next: "new" });
  assert.equal(updateCalls, 0);
  assert.equal(successCount, 0);
  assert.deepEqual(errors, []);

  await submitFeedbackStatusChange({ ...options, next: "dismissed" });
  assert.equal(updateCalls, 1);
  assert.equal(successCount, 0);
  assert.deepEqual(errors, ["Unable to save status."]);
});
