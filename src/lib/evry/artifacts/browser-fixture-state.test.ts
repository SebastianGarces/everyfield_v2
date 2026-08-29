import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVRY_ARTIFACT_BROWSER_FIXTURE_STORAGE_KEY,
  createEvryArtifactBrowserFixtureStore,
  initialEvryArtifactBrowserFixtureSnapshot,
  parseEvryArtifactBrowserFixtureSnapshot,
  persistEvryArtifactBrowserFixtureSnapshot,
  restoreEvryArtifactBrowserFixtureSnapshot,
  type EvryArtifactBrowserFixtureStorage,
} from "./browser-fixture-state";
import {
  INITIAL_MEETING_CONFIRMATION,
  meetingProgressFixture,
  partialMeetingReceiptFixture,
} from "./fixtures";
import {
  beginEvryArtifactEdit,
  beginEvryArtifactExecution,
  cancelEvryArtifactReview,
  finishEvryArtifactExecution,
} from "./interaction";

function memoryStorage(): EvryArtifactBrowserFixtureStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function terminalSnapshot() {
  const initial = initialEvryArtifactBrowserFixtureSnapshot();
  const progress = meetingProgressFixture(INITIAL_MEETING_CONFIRMATION.plan);
  const executing = beginEvryArtifactExecution(initial.state, progress);
  assert.equal(executing.shouldExecute, true);
  const receipt = partialMeetingReceiptFixture(progress.plan);
  return parseEvryArtifactBrowserFixtureSnapshot({
    ...initial,
    state: finishEvryArtifactExecution(executing.state, receipt),
    notice:
      "The durable receipt preserves completed work and marks only the email step as safe to retry.",
    acceptedExecutions: 1,
    completionDueAt: null,
  });
}

test("a terminal receipt and one-shot execution count survive a browser reload", () => {
  const storage = memoryStorage();
  const terminal = terminalSnapshot();

  createEvryArtifactBrowserFixtureStore(storage).replace(terminal);
  const restored = createEvryArtifactBrowserFixtureStore(storage).getSnapshot();

  assert.deepEqual(restored, terminal);
  assert.equal(restored.state.status, "receipt");
  assert.equal(restored.acceptedExecutions, 1);
});

test("a cancelled confirmation survives a browser reload", () => {
  const storage = memoryStorage();
  const initial = initialEvryArtifactBrowserFixtureSnapshot();
  const cancelled = parseEvryArtifactBrowserFixtureSnapshot({
    ...initial,
    state: cancelEvryArtifactReview(initial.state),
    notice: "Plan cancelled. Nothing was executed.",
  });

  createEvryArtifactBrowserFixtureStore(storage).replace(cancelled);

  assert.deepEqual(
    createEvryArtifactBrowserFixtureStore(storage).getSnapshot(),
    cancelled
  );
});

test("every interaction state round-trips and executing state keeps its completion deadline", () => {
  const initial = initialEvryArtifactBrowserFixtureSnapshot();
  const progress = meetingProgressFixture(INITIAL_MEETING_CONFIRMATION.plan);
  const executing = beginEvryArtifactExecution(initial.state, progress).state;
  const states = [
    initial,
    parseEvryArtifactBrowserFixtureSnapshot({
      ...initial,
      state: beginEvryArtifactEdit(initial.state),
      notice: "The prior confirmation is invalid.",
    }),
    parseEvryArtifactBrowserFixtureSnapshot({
      ...initial,
      state: cancelEvryArtifactReview(initial.state),
      notice: "Plan cancelled. Nothing was executed.",
    }),
    parseEvryArtifactBrowserFixtureSnapshot({
      ...initial,
      state: executing,
      notice: "Execution started once.",
      acceptedExecutions: 1,
      completionDueAt: 1_787_967_200_000,
    }),
    terminalSnapshot(),
  ];

  for (const snapshot of states) {
    const storage = memoryStorage();
    persistEvryArtifactBrowserFixtureSnapshot(storage, snapshot);
    assert.deepEqual(
      restoreEvryArtifactBrowserFixtureSnapshot(storage),
      snapshot,
      snapshot.state.status
    );
  }
});

test("invalid or internally inconsistent stored state fails closed to a fresh fixture", () => {
  const storage = memoryStorage();
  storage.setItem(EVRY_ARTIFACT_BROWSER_FIXTURE_STORAGE_KEY, "not json");
  assert.deepEqual(
    restoreEvryArtifactBrowserFixtureSnapshot(storage),
    initialEvryArtifactBrowserFixtureSnapshot()
  );
  assert.equal(storage.values.size, 0);

  assert.throws(() =>
    parseEvryArtifactBrowserFixtureSnapshot({
      ...initialEvryArtifactBrowserFixtureSnapshot(),
      completionDueAt: 1_787_967_200_000,
    })
  );
  assert.throws(() =>
    parseEvryArtifactBrowserFixtureSnapshot({
      ...initialEvryArtifactBrowserFixtureSnapshot(),
      acceptedExecutions: 1,
    })
  );
});

test("reset removes durable fixture state", () => {
  const storage = memoryStorage();
  const store = createEvryArtifactBrowserFixtureStore(storage);
  assert.equal(store.getServerSnapshot(), null);
  store.replace(terminalSnapshot());

  store.reset();

  assert.equal(storage.values.size, 0);
  assert.deepEqual(
    store.getSnapshot(),
    initialEvryArtifactBrowserFixtureSnapshot()
  );
});
