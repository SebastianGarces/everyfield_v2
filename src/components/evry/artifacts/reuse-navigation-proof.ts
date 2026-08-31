import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  createElement,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

const SOURCE_ID = "20000000-0000-4000-8000-000000000001";
const TARGET_ID = "20000000-0000-4000-8000-000000000002";
const ARTIFACT_ID = "30000000-0000-4000-8000-000000000001";
const RELOAD_REQUEST_ID = "40000000-0000-4000-8000-000000000001";
let route = { pathname: "/evry", search: `?conversation=${SOURCE_ID}` };
const listeners = new Set<() => void>();
const pushes: string[] = [];
let beforeDirectLinkDispatch: (() => void) | null = null;
const router = {
  bfcacheId: "fixture",
  back() {},
  forward() {},
  refresh() {},
  replace(value: string) {
    pushes.push(value);
  },
  prefetch() {
    return Promise.resolve();
  },
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
    useRouter: () => useContext(AppRouterContext) ?? router,
  },
});
mock.module("next/dynamic", { defaultExport: () => () => null });
function MockLink({
  children,
  href,
  onClick,
  onNavigate,
  ...props
}: {
  children: ReactNode;
  href: string;
  onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  onNavigate?: (event: { preventDefault(): void }) => void;
  target?: string;
  download?: string;
  id?: string;
}) {
  return createElement(
    "a",
    {
      ...props,
      href,
      onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          (props.target !== undefined && props.target !== "_self") ||
          props.download !== undefined
        ) {
          return;
        }
        event.preventDefault();
        let navigationPrevented = false;
        onNavigate?.({
          preventDefault: () => {
            navigationPrevented = true;
          },
        });
        if (navigationPrevented) return;
        beforeDirectLinkDispatch?.();
        pushes.push(href);
      },
    },
    children
  );
}
mock.module("next/link", { defaultExport: MockLink });
mock.module("@/components/header/header-context", {
  namedExports: { useHeader: () => ({ breadcrumbs: [] }) },
});
mock.module("@/components/feedback/feedback-button", {
  namedExports: { FeedbackButton: () => null },
});
mock.module("@/components/header/mobile-sidebar-trigger", {
  namedExports: { MobileSidebarTrigger: () => null },
});
mock.module("@/components/logo", {
  namedExports: {
    Mark: (props: Record<string, unknown>) => createElement("svg", props),
  },
});
mock.module("@/components/nav-user", {
  namedExports: { NavUser: () => null },
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

function clickEvent(
  overrides: Partial<
    Pick<
      ReactMouseEvent<HTMLAnchorElement>,
      "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
    >
  > = {}
): ReactMouseEvent<HTMLAnchorElement> {
  let defaultPrevented = false;
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault() {
      defaultPrevented = true;
    },
  } as ReactMouseEvent<HTMLAnchorElement>;
}

test("reuse owns delayed workspace navigation and ignores completion after departure", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated")) {
      process.stderr.write(`${args.map(String).join(" ")}\n`);
    }
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  const storage = memoryStorage();
  const documentListeners = new Map<string, Set<EventListener>>();
  const windowListeners = new Map<string, Set<EventListener>>();
  const addListener = (
    registry: Map<string, Set<EventListener>>,
    type: string,
    listener: EventListenerOrEventListenerObject
  ) => {
    if (typeof listener !== "function") return;
    const registered = registry.get(type) ?? new Set<EventListener>();
    registered.add(listener);
    registry.set(type, registered);
  };
  const removeListener = (
    registry: Map<string, Set<EventListener>>,
    type: string,
    listener: EventListenerOrEventListenerObject
  ) => {
    if (typeof listener === "function") registry.get(type)?.delete(listener);
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: storage,
      location: {
        origin: "https://example.test",
        pathname: "/evry",
        search: `?conversation=${SOURCE_ID}`,
      },
      setTimeout,
      clearTimeout,
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject
      ) => addListener(windowListeners, type, listener),
      removeEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject
      ) => removeListener(windowListeners, type, listener),
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      getElementById: () => null,
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject
      ) => addListener(documentListeners, type, listener),
      removeEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject
      ) => removeListener(documentListeners, type, listener),
    },
  });
  t.after(() => {
    beforeDirectLinkDispatch = null;
    listeners.clear();
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });

  const first = Promise.withResolvers<Response>();
  const second = Promise.withResolvers<Response>();
  const third = Promise.withResolvers<Response>();
  const fourth = Promise.withResolvers<Response>();
  const responses = [first, second, third, fourth];
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
  const { AuthenticatedLink } =
    await import("@/components/authenticated-navigation");
  const { GlobalAppBar } = await import("@/components/header/global-app-bar");
  const { useRouter } = await import("next/navigation");
  function MountedWorkspace() {
    const current = useEvryShell();
    const navigation = useRouter();
    const mountedConversationId = current.conversation?.id ?? null;
    const acknowledgeConversationMounted =
      current.acknowledgeConversationMounted;
    useEffect(() => {
      if (mountedConversationId) {
        acknowledgeConversationMounted(mountedConversationId);
      }
    }, [acknowledgeConversationMounted, mountedConversationId]);
    return createElement(
      "section",
      null,
      createElement("output", {
        "data-id": current.conversation?.id ?? "none",
        "data-blocked": String(current.isComposerBlocked),
        "data-load": current.loadConversation,
        "data-start": current.startRecipeReuse,
      }),
      createElement(
        AuthenticatedLink,
        {
          id: "control-disabled-link",
          href: "/evry?new=1",
          "aria-disabled": "true",
          onClick: (event: ReactMouseEvent<HTMLAnchorElement>) =>
            event.preventDefault(),
        },
        "New"
      ),
      createElement(
        AuthenticatedLink,
        { id: "control-modified-link", href: "/dashboard" },
        "Modified"
      ),
      createElement(
        AuthenticatedLink,
        {
          id: "control-new-context-link",
          href: "/dashboard",
          target: "_blank",
        },
        "New context"
      ),
      createElement(
        AuthenticatedLink,
        { id: "control-hash-link", href: "#receipt" },
        "Receipt"
      ),
      createElement(
        AuthenticatedLink,
        {
          id: "control-download-link",
          href: "/download",
          download: "receipt.json",
        },
        "Download"
      ),
      createElement("button", {
        id: "control-ordinary-button",
        onClick: () => undefined,
      }),
      createElement(
        "form",
        {
          id: "control-prevented-form",
          onSubmit: (event: Event) => event.preventDefault(),
        },
        createElement("button", { type: "submit" })
      ),
      createElement(
        AuthenticatedLink,
        {
          id: "control-prevented-navigation",
          href: "/dashboard",
          onNavigate: (event: { preventDefault(): void }) =>
            event.preventDefault(),
        },
        "Prevented navigation"
      ),
      createElement("button", {
        id: "control-programmatic-current",
        onClick: () =>
          navigation.push(`/evry?conversation=${SOURCE_ID}#receipt`),
      })
    );
  }
  function ShellChildren() {
    return createElement(
      "main",
      null,
      createElement(GlobalAppBar, {
        shell: { label: "Church Planting", homeHref: "/dashboard" },
        user: {
          name: "Planter",
          email: "planter@example.test",
          initials: "P",
        },
      }),
      createElement(MountedWorkspace)
    );
  }
  let renderer: ReactTestRenderer | null = null;
  await act(async () => {
    renderer = create(
      createElement(EvryShell, {
        enabled: true,
        eligibleSuggestions: [],
        children: createElement(ShellChildren),
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
  const control = (name: string) =>
    mounted.root.findAllByProps({ id: `control-${name}` }).at(-1)!;
  await act(async () => {
    control("disabled-link").props.onClick(clickEvent());
    control("modified-link").props.onClick(clickEvent({ metaKey: true }));
    control("new-context-link").props.onClick(clickEvent());
    control("hash-link").props.onClick(clickEvent());
    control("download-link").props.onClick(clickEvent());
    control("ordinary-button").props.onClick();
    const preventedSubmit = clickEvent();
    control("prevented-form").props.onSubmit(preventedSubmit);
    assert.equal(preventedSubmit.defaultPrevented, true);
    control("prevented-navigation").props.onClick(clickEvent());
    control("programmatic-current").props.onClick();
  });
  assert.equal(
    output()["data-blocked"],
    "true",
    "the valid reuse remains the only reason the composer is blocked"
  );
  second.resolve(
    Response.json(
      { status: "created", conversation: conversation(TARGET_ID) },
      { status: 201 }
    )
  );
  await act(async () => void (await started));
  assert.equal(output()["data-id"], TARGET_ID);
  assert.deepEqual(
    pushes,
    [
      `/evry?conversation=${TARGET_ID}`,
      "#receipt",
      `/evry?conversation=${SOURCE_ID}#receipt`,
      `/evry?conversation=${TARGET_ID}`,
    ],
    "disabled, prevented, modified, new-context, hash, download, and ordinary controls preserve reuse ownership"
  );
  assert.equal(storage.length, 1);
  await act(async () => navigate("/evry", `?conversation=${TARGET_ID}`));
  assert.equal(storage.length, 0);
  assert.equal(output()["data-blocked"], "false");

  await act(async () => navigate("/evry", `?conversation=${SOURCE_ID}`));
  await act(async () => {
    started = output()["data-start"]({
      sourceConversationId: SOURCE_ID,
      resultArtifactId: ARTIFACT_ID,
      recipeIdentity: "meeting.invitation.reference",
    });
  });
  beforeDirectLinkDispatch = () => {
    assert.equal(
      storage.length,
      0,
      "product onNavigate revokes reuse before Next direct dispatch"
    );
  };
  const globalAppBrand = mounted.root
    .findAllByProps({
      "aria-label": "EveryField — Church Planting home",
    })
    .at(-1)!;
  await act(async () => {
    globalAppBrand.props.onClick(clickEvent());
  });
  beforeDirectLinkDispatch = null;
  assert.equal(
    output()["data-blocked"],
    "true",
    "source remains blocked while the real Next navigation is pending"
  );
  await act(async () => void (await output()["data-load"](SOURCE_ID)));
  assert.equal(fetches.length, 3, "pending departure cannot reload source A");
  third.resolve(
    Response.json(
      { status: "created", conversation: conversation(TARGET_ID) },
      { status: 201 }
    )
  );
  await act(async () => void (await started));
  assert.equal(
    pushes.at(-1),
    "/dashboard",
    "late completion cannot enqueue B behind the pending Next navigation"
  );
  assert.equal(storage.length, 0);
  assert.equal(output()["data-blocked"], "true");
  await act(async () => navigate("/dashboard"));
  assert.equal(output()["data-blocked"], "false");
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
        children: createElement(ShellChildren),
      })
    );
  });
  assert.ok(reloadedRenderer);
  fourth.resolve(
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
