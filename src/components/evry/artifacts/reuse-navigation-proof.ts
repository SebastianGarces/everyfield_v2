import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  createElement,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const SOURCE_ID = "20000000-0000-4000-8000-000000000001";
const TARGET_ID = "20000000-0000-4000-8000-000000000002";
const ARTIFACT_ID = "30000000-0000-4000-8000-000000000001";
const RELOAD_REQUEST_ID = "40000000-0000-4000-8000-000000000001";
let route = { pathname: "/evry", search: `?conversation=${SOURCE_ID}` };
const listeners = new Set<() => void>();
const pushes: string[] = [];
const router = {
  back() {},
  push(value: string) {
    pushes.push(value);
  },
};

function useRouteSnapshot() {
  return useSyncExternalStore(
    (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    () => route,
    () => route
  );
}
function navigate(pathname: string, search = "") {
  route = { pathname, search };
  for (const listener of listeners) listener();
}

mock.module("next/navigation", {
  namedExports: {
    usePathname: () => useRouteSnapshot().pathname,
    useSearchParams: () => {
      const current = useRouteSnapshot();
      return useMemo(
        () => new URLSearchParams(current.search),
        [current.search]
      );
    },
    useRouter: () => router,
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

function conversation(id: string) {
  return {
    id,
    title: "Fresh reusable recipe",
    createdAt: "2026-08-30T12:00:00.000Z",
    lastActivityAt: "2026-08-30T12:00:01.000Z",
    activePlan: null,
    stateVersion: 0,
    state: {},
    messages: [],
  };
}

test("reuse owns delayed workspace navigation and ignores completion after departure", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated")) {
      process.stderr.write(`${args.map(String).join(" ")}\n`);
    }
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: storage },
  });
  t.after(() => {
    listeners.clear();
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const first = Promise.withResolvers<Response>();
  const second = Promise.withResolvers<Response>();
  const third = Promise.withResolvers<Response>();
  const responses = [first, second, third];
  const fetches: string[] = [];
  const bodies: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      fetches.push(String(input));
      bodies.push(String(init?.body ?? ""));
      const pending = responses.shift();
      if (!pending) throw new Error("stale conversation load escaped");
      return pending.promise;
    }
  );
  const { EvryShell, useEvryShell } = await import("../evry-shell");
  function MountedWorkspace() {
    const current = useEvryShell();
    const mountedConversationId = current.conversation?.id ?? null;
    const acknowledgeConversationMounted =
      current.acknowledgeConversationMounted;
    useEffect(() => {
      if (mountedConversationId) {
        acknowledgeConversationMounted(mountedConversationId);
      }
    }, [acknowledgeConversationMounted, mountedConversationId]);
    return createElement("output", {
      "data-id": current.conversation?.id ?? "none",
      "data-blocked": String(current.isComposerBlocked),
      "data-load": current.loadConversation,
      "data-start": current.startRecipeReuse,
    });
  }
  let renderer: ReactTestRenderer | null = null;
  await act(async () => {
    renderer = create(
      createElement(EvryShell, {
        enabled: true,
        eligibleSuggestions: [],
        children: createElement(MountedWorkspace),
      })
    );
  });
  assert.ok(renderer);
  const mounted = renderer as ReactTestRenderer;
  const output = () => mounted.root.findByType("output").props;

  let started!: Promise<"started" | "unavailable">;
  await act(async () => {
    started = output()["data-start"]({
      sourceConversationId: SOURCE_ID,
      resultArtifactId: ARTIFACT_ID,
      recipeIdentity: "meeting.invitation.reference",
    });
  });
  assert.equal(output()["data-blocked"], "true");
  first.resolve(
    Response.json(
      { status: "created", conversation: conversation(TARGET_ID) },
      { status: 201 }
    )
  );
  await act(async () => void (await started));
  assert.equal(output()["data-id"], TARGET_ID);
  assert.equal(
    output()["data-blocked"],
    "true",
    "destination remains owned before route commit"
  );
  assert.deepEqual(pushes, [`/evry?conversation=${TARGET_ID}`]);
  await act(async () => void (await output()["data-load"](SOURCE_ID)));
  assert.equal(
    fetches.length,
    1,
    "stale source cannot reload while reuse owns navigation"
  );
  await act(async () => navigate("/evry", `?conversation=${TARGET_ID}`));
  assert.equal(output()["data-blocked"], "false");
  assert.equal(storage.length, 0);

  await act(async () => navigate("/evry", `?conversation=${SOURCE_ID}`));
  await act(async () => {
    started = output()["data-start"]({
      sourceConversationId: SOURCE_ID,
      resultArtifactId: ARTIFACT_ID,
      recipeIdentity: "meeting.invitation.reference",
    });
  });
  await act(async () => navigate("/dashboard"));
  second.resolve(
    Response.json(
      { status: "created", conversation: conversation(TARGET_ID) },
      { status: 201 }
    )
  );
  await act(async () => void (await started));
  assert.equal(
    pushes.length,
    1,
    "late completion cannot navigate after route departure"
  );
  assert.equal(storage.length, 0);
  await act(async () => mounted.unmount());

  const { writeEvryRunRecoveryMarker } =
    await import("../streaming/run-recovery");
  navigate("/evry", `?conversation=${SOURCE_ID}`);
  writeEvryRunRecoveryMarker(
    {
      requestId: RELOAD_REQUEST_ID,
      kind: "conversation",
      operation: "reuse",
      conversationId: null,
      sourceConversationId: SOURCE_ID,
      resultArtifactId: ARTIFACT_ID,
      recipeIdentity: "meeting.invitation.reference",
      sourceLocation: {
        pathname: "/evry",
        search: `?conversation=${SOURCE_ID}`,
      },
    },
    storage
  );
  let reloadedRenderer: ReactTestRenderer | null = null;
  await act(async () => {
    reloadedRenderer = create(
      createElement(EvryShell, {
        enabled: true,
        eligibleSuggestions: [],
        children: createElement(MountedWorkspace),
      })
    );
  });
  assert.ok(reloadedRenderer);
  third.resolve(
    Response.json(
      { status: "created", conversation: conversation(TARGET_ID) },
      { status: 201 }
    )
  );
  await act(async () => await Promise.resolve());
  assert.deepEqual(JSON.parse(bodies.at(-1) ?? "null"), {
    requestKey: RELOAD_REQUEST_ID,
    resultArtifactId: ARTIFACT_ID,
    recipeIdentity: "meeting.invitation.reference",
  });
  assert.equal(pushes.at(-1), `/evry?conversation=${TARGET_ID}`);
  await act(async () => navigate("/evry", `?conversation=${TARGET_ID}`));
  assert.equal(storage.length, 0);
  await act(async () => reloadedRenderer!.unmount());
});
