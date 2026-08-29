import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  createElement,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const CONVERSATION_A_ID = "20000000-0000-4000-8000-000000000001";
const CONVERSATION_B_ID = "20000000-0000-4000-8000-000000000002";
const REQUEST_ID = "10000000-0000-4000-8000-000000000001";

type RouteSnapshot = Readonly<{ pathname: string; search: string }>;
type FocusNode = {
  id: string | null;
  focus(): void;
  contains(candidate: FocusNode | null): boolean;
  scrollIntoView(): void;
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
};
let routeSnapshot: RouteSnapshot = {
  pathname: "/evry",
  search: `?conversation=${CONVERSATION_A_ID}`,
};
const routeListeners = new Set<() => void>();

function useRouteSnapshot(): RouteSnapshot {
  return useSyncExternalStore(
    (listener) => {
      routeListeners.add(listener);
      return () => routeListeners.delete(listener);
    },
    () => routeSnapshot,
    () => routeSnapshot
  );
}

function navigate(search: string): void {
  routeSnapshot = { pathname: "/evry", search };
  for (const listener of routeListeners) listener();
}

mock.module("next/navigation", {
  namedExports: {
    usePathname: () => useRouteSnapshot().pathname,
    useSearchParams: () => {
      const { search } = useRouteSnapshot();
      return useMemo(() => new URLSearchParams(search), [search]);
    },
    useRouter: () => ({ back() {}, push() {} }),
  },
});
mock.module("next/dynamic", { defaultExport: () => () => null });
mock.module("next/link", {
  defaultExport: ({ children, ...props }: { children: ReactNode }) =>
    createElement("a", props, children),
});
mock.module("@/components/header/header-context", {
  namedExports: { useHeader: () => ({ breadcrumbs: [] }) },
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
    setItem: (key, value) => void values.set(key, value),
  };
}

test("navigation pauses one observation, rejects its stale completion, and reconnects on return", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: storage },
  });
  t.after(() => {
    routeListeners.clear();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  const firstRead = Promise.withResolvers<Response>();
  const secondRead = Promise.withResolvers<Response>();
  const reads = [firstRead, secondRead];
  let readCount = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const response = reads[readCount];
    readCount += 1;
    if (!response) throw new Error("Unexpected recovery read");
    return response.promise;
  });

  const [{ EvryShell, useEvryShell }, { writeEvryRunRecoveryMarker }] =
    await Promise.all([
      import("@/components/evry/evry-shell"),
      import("./run-recovery"),
    ]);
  writeEvryRunRecoveryMarker(
    {
      requestId: REQUEST_ID,
      kind: "conversation",
      conversationId: CONVERSATION_A_ID,
    },
    storage
  );

  function Probe() {
    const shell = useEvryShell();
    return createElement("output", {
      "data-conversation": shell.conversation?.id ?? "none",
      "data-working": String(shell.isWorking),
      "data-stoppable": String(shell.canStopWatching),
    });
  }

  let renderer: ReactTestRenderer | null = null;
  await act(async () => {
    renderer = create(
      createElement(EvryShell, {
        enabled: true,
        eligibleSuggestions: [],
        children: createElement(Probe),
      })
    );
  });
  assert.ok(renderer);
  const mounted = renderer as ReactTestRenderer;
  const probe = () => mounted.root.findByType("output").props;
  assert.equal(readCount, 1);
  assert.equal(probe()["data-working"], "true");

  await act(async () => navigate(`?conversation=${CONVERSATION_B_ID}`));
  assert.equal(probe()["data-working"], "false");
  await act(async () => navigate(`?conversation=${CONVERSATION_A_ID}`));
  assert.equal(readCount, 2);
  assert.equal(probe()["data-working"], "true");
  assert.equal(probe()["data-stoppable"], "true");

  firstRead.resolve(
    Response.json({
      status: "durable",
      requestId: REQUEST_ID,
      kind: "conversation",
      sequence: 4,
      conversation: {
        id: CONVERSATION_A_ID,
        title: "Conversation A",
        createdAt: "2026-08-29T01:00:00.000Z",
        lastActivityAt: "2026-08-29T01:01:00.000Z",
        activePlan: null,
        stateVersion: 0,
        state: {},
        messages: [],
      },
    })
  );
  await act(async () => await Promise.resolve());
  assert.equal(
    probe()["data-conversation"],
    "none",
    "the aborted observer cannot settle the replacement"
  );
  assert.equal(probe()["data-working"], "true");
  assert.equal(
    probe()["data-stoppable"],
    "true",
    "the aborted observer cannot clear replacement ownership"
  );

  secondRead.resolve(
    Response.json({
      status: "durable",
      requestId: REQUEST_ID,
      kind: "conversation",
      sequence: 5,
      conversation: {
        id: CONVERSATION_A_ID,
        title: "Conversation A",
        createdAt: "2026-08-29T01:00:00.000Z",
        lastActivityAt: "2026-08-29T01:01:00.000Z",
        activePlan: null,
        stateVersion: 0,
        state: {},
        messages: [],
      },
    })
  );
  await act(async () => await Promise.resolve());
  assert.equal(probe()["data-conversation"], CONVERSATION_A_ID);
  assert.equal(probe()["data-working"], "false");
  assert.equal(storage.length, 0);

  await act(async () => mounted.unmount());
});

test("reconnect hands focus to the stable status before its control unmounts", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  routeSnapshot = {
    pathname: "/evry",
    search: `?conversation=${CONVERSATION_A_ID}`,
  };
  const storage = memoryStorage();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  let activeElement: FocusNode | null = null;
  const focusHistory: Array<string | null> = [];
  const nodes = new Map<string, FocusNode>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: storage },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get activeElement() {
        return activeElement;
      },
      getElementById(id: string) {
        return nodes.get(id) ?? null;
      },
    },
  });
  t.after(() => {
    routeListeners.clear();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  });

  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    reads += 1;
    if (reads === 1) throw new Error("temporary reconnect failure");
    return Response.json({
      status: "durable",
      requestId: REQUEST_ID,
      kind: "conversation",
      sequence: 4,
      conversation: {
        id: CONVERSATION_A_ID,
        title: "Conversation A",
        createdAt: "2026-08-29T01:00:00.000Z",
        lastActivityAt: "2026-08-29T01:01:00.000Z",
        activePlan: null,
        stateVersion: 0,
        state: {},
        messages: [],
      },
    });
  });

  const [shellModule, surfaceModule, recoveryModule] = await Promise.all([
    import("@/components/evry/evry-shell"),
    import("@/components/evry/conversation-surface"),
    import("./run-recovery"),
  ]);
  recoveryModule.writeEvryRunRecoveryMarker(
    {
      requestId: REQUEST_ID,
      kind: "conversation",
      conversationId: CONVERSATION_A_ID,
    },
    storage
  );

  let renderer: ReactTestRenderer | null = null;
  await act(async () => {
    renderer = create(
      createElement(shellModule.EvryShell, {
        enabled: true,
        eligibleSuggestions: [],
        children: createElement(surfaceModule.ConversationSurface),
      }),
      {
        createNodeMock(element) {
          const props = element.props as Record<string, unknown>;
          const id = typeof props.id === "string" ? props.id : null;
          const existing = id ? nodes.get(id) : undefined;
          if (existing) return existing;
          const node: FocusNode = {
            id,
            focus() {
              activeElement = node;
              focusHistory.push(id);
            },
            contains(candidate) {
              return candidate === node || candidate?.id === "evry-message";
            },
            scrollIntoView() {},
            scrollHeight: 100,
            clientHeight: 100,
            scrollTop: 0,
          };
          if (id) nodes.set(id, node);
          return node;
        },
      }
    );
    await Promise.resolve();
  });
  assert.ok(renderer);
  const mounted = renderer as ReactTestRenderer;
  for (
    let attempt = 0;
    attempt < 10 &&
    mounted.root.findAll(
      (node) =>
        node.type === "button" &&
        node.children.includes("Reconnect to this run")
    ).length === 0;
    attempt++
  ) {
    await act(async () => await Promise.resolve());
  }
  const reconnect = mounted.root.find(
    (node) =>
      node.type === "button" && node.children.includes("Reconnect to this run")
  );
  assert.equal(
    mounted.root.findByProps({ id: "evry-work-status" }).instance.id,
    "evry-work-status"
  );
  reconnect.instance.focus();
  await act(async () => {
    reconnect.props.onClick();
    await Promise.resolve();
  });
  assert.deepEqual(focusHistory.slice(-1), ["evry-work-status"]);
  assert.equal(
    mounted.root.findAll(
      (node) =>
        node.type === "button" &&
        node.children.includes("Reconnect to this run")
    ).length,
    0
  );
  assert.deepEqual(focusHistory.slice(-1), ["evry-work-status"]);
  await act(async () => mounted.unmount());
});
