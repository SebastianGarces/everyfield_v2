import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "20000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const PLAN_ID = "40000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "50000000-0000-4000-8000-000000000001";

mock.module("@/components/evry/evry-shell", {
  namedExports: {
    useEvryShell: () => ({
      canStopWatching: false,
      isWatchingDetached: false,
      resumeWatching() {},
      stopWatching() {},
      workRequestId: REQUEST_ID,
      workState: { phase: "execution", message: "Reconnected" },
    }),
  },
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function response(completed: boolean): Response {
  return Response.json({
    status: "available",
    proof: {
      kind: "execution",
      requestId: REQUEST_ID,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      planId: PLAN_ID,
      attemptId: ATTEMPT_ID,
      starts: 1,
      effectCount: completed ? 1 : 0,
      stage: completed ? "complete" : "executing",
      result: completed ? "completed" : "active",
    },
  });
}

function button(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find(
    (node) => node.type === "button" && node.children.includes(label)
  );
}

test("the fixture writes the production marker, performs a full reload, and then asks the server to complete", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  let href = "https://preview.example/evry?artifactFixture=stream-reconnect";
  let reloads = 0;
  class MockHistory {
    replaceState(
      _state: unknown,
      _unused: string,
      nextHref?: string | URL | null
    ) {
      if (nextHref) href = new URL(String(nextHref), href).href;
    }
  }
  const history = new MockHistory() as History;
  Object.assign(history, { state: { __NA: true } });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      History: MockHistory,
      history,
      location: {
        get href() {
          return href;
        },
        reload() {
          reloads += 1;
        },
      },
      sessionStorage: storage,
      setTimeout(callback: () => void) {
        return globalThis.setTimeout(callback, 0);
      },
      clearTimeout(timer: ReturnType<typeof setTimeout>) {
        globalThis.clearTimeout(timer);
      },
    },
  });
  t.after(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  let completed = false;
  const calls: Array<Readonly<{ url: string; body: unknown }>> = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: String(input), body });
      if (body?.action === "complete") completed = true;
      return response(completed);
    }
  );

  const { EvryRunRecoveryBrowserFixture } =
    await import("./run-recovery-browser-fixture");
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(EvryRunRecoveryBrowserFixture));
  });
  await act(async () => {
    button(renderer, "Start execution proof").props.onClick();
    for (let count = 0; count < 4; count++) await Promise.resolve();
  });
  assert.match(href, new RegExp(`conversation=${CONVERSATION_ID}`));
  assert.equal(
    JSON.parse(storage.getItem("evry.active-run.v1") ?? "null").requestId,
    REQUEST_ID
  );
  assert.equal(
    renderer.root.findByProps({ "data-testid": "reconnect-work-starts" })
      .children[0],
    "1"
  );
  const attemptBeforeReload = renderer.root.findByProps({
    "data-testid": "reconnect-attempt-id",
  }).children[0];
  assert.equal(attemptBeforeReload, ATTEMPT_ID);

  await act(async () =>
    button(renderer, "Reload page during run").props.onClick()
  );
  assert.equal(reloads, 1);
  assert.equal(
    JSON.parse(storage.getItem("evry.run-recovery-preview.v1") ?? "null").phase,
    "reload_requested"
  );
  await act(async () => renderer.unmount());

  await act(async () => {
    renderer = create(createElement(EvryRunRecoveryBrowserFixture));
    for (let count = 0; count < 8; count++) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    }
  });
  assert.equal(
    calls.some(({ body }) =>
      Boolean(
        body &&
        typeof body === "object" &&
        "action" in body &&
        body.action === "complete"
      )
    ),
    true
  );
  assert.equal(
    renderer.root.findByProps({ "data-testid": "reconnect-attempt-id" })
      .children[0],
    attemptBeforeReload
  );
  assert.equal(
    renderer.root.findByProps({ "data-testid": "reconnect-effect-count" })
      .children[0],
    "1"
  );
  assert.equal(
    renderer.root.findByProps({ "data-testid": "reconnect-result" })
      .children[0],
    "completed"
  );
  await act(async () => renderer.unmount());
});
