import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  beginDialogSave,
  closeDialogSave,
  INITIAL_DIALOG_SAVE_STATE,
  openDialogSave,
  settleDialogSave,
} from "./dialog-save-lifecycle";

const dialogs = [
  "src/components/ministry-teams/create-team-dialog.tsx",
  "src/components/ministry-teams/training-tab.tsx",
  "src/components/ministry-teams/meetings-tab.tsx",
  "src/components/ministry-teams/role-template-import.tsx",
];

test("a failed save keeps the dialog and its entered values available for retry", () => {
  const opened = openDialogSave(INITIAL_DIALOG_SAVE_STATE, 1);
  const saving = beginDialogSave(opened, 2);
  const failed = settleDialogSave(saving, 2, {
    success: false,
    error: "Unable to save this team.",
  });

  assert.deepEqual(failed, {
    open: true,
    loading: false,
    error: "Unable to save this team.",
    attempt: 2,
  });
});

test("a retry clears the error and only a successful current attempt closes", () => {
  const failed = settleDialogSave(
    beginDialogSave(openDialogSave(INITIAL_DIALOG_SAVE_STATE, 1), 2),
    2,
    { success: false, error: "Unable to save this team." }
  );
  const retrying = beginDialogSave(failed, 3);

  assert.equal(retrying.error, null);
  assert.equal(retrying.open, true);
  assert.equal(retrying.loading, true);

  assert.deepEqual(settleDialogSave(retrying, 3, { success: true }), {
    open: false,
    loading: false,
    error: null,
    attempt: 3,
  });
});

test("closing invalidates a pending save, so reopen starts clean", () => {
  const saving = beginDialogSave(
    openDialogSave(INITIAL_DIALOG_SAVE_STATE, 1),
    2
  );
  const closed = closeDialogSave(saving, 3);
  const staleFailure = settleDialogSave(closed, 2, {
    success: false,
    error: "Late failure",
  });

  assert.deepEqual(staleFailure, closed);
  assert.deepEqual(openDialogSave(staleFailure, 4), {
    open: true,
    loading: false,
    error: null,
    attempt: 4,
  });
});

test("a late result from a superseded attempt cannot overwrite the retry", () => {
  const first = beginDialogSave(
    openDialogSave(INITIAL_DIALOG_SAVE_STATE, 1),
    2
  );
  const retry = beginDialogSave(first, 3);
  const staleFailure = settleDialogSave(retry, 2, {
    success: false,
    error: "Late failure",
  });

  assert.deepEqual(staleFailure, retry);
  assert.deepEqual(
    settleDialogSave(staleFailure, 3, {
      success: false,
      error: "Current failure",
    }),
    {
      open: true,
      loading: false,
      error: "Current failure",
      attempt: 3,
    }
  );
});

test("every affected dialog delegates lifecycle ownership to the shared controller", () => {
  for (const dialog of dialogs) {
    const source = readFileSync(path.join(process.cwd(), dialog), "utf8");

    assert.match(
      source,
      /useDialogSaveLifecycle\(\)/,
      `${dialog} owns save lifecycle state instead of using the shared controller`
    );
    assert.ok(
      /onOpenChange=\{(?:onOpenChange|onAddOpenChange)\}/.test(source) ||
        /onOpenChange=\{\(value\) => \{[\s\S]*?onOpenChange\(value\)/.test(
          source
        ),
      `${dialog} does not send Escape and overlay closes through the controller`
    );
    assert.match(
      source,
      /role="alert"[\s\S]*?<DialogFooter>/,
      `${dialog} does not keep its recoverable error above the footer`
    );
  }
});
