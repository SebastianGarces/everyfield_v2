import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  createElement,
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import type { PublicEvryConversation } from "@/components/evry/client-contract";
import type { EvryConversationHistoryItem } from "@/lib/evry/conversations/history";

type RouteState = Readonly<{
  conversationId: string | null;
  newConversation: boolean;
  revision: number;
}>;

class RouteRemountController {
  #setRoute: Dispatch<SetStateAction<RouteState>> | null = null;
  pushes: string[] = [];

  observe(setRoute: Dispatch<SetStateAction<RouteState>>): void {
    this.#setRoute = setRoute;
  }

  push(href: string): void {
    this.pushes.push(href);
    this.#setRoute?.((current) => ({
      ...current,
      revision: current.revision + 1,
    }));
  }

  commit(conversationId: string | null, newConversation = false): void {
    this.#setRoute?.((current) => ({
      conversationId,
      newConversation,
      revision: current.revision + 1,
    }));
  }

  reset(): void {
    this.#setRoute = null;
    this.pushes.length = 0;
  }
}

const route = new RouteRemountController();

mock.module("next/navigation", {
  namedExports: {
    usePathname: () => "/evry",
    useRouter: () => ({
      back: () => {},
      push: (href: string) => route.push(href),
    }),
  },
});

mock.module("next/dynamic", {
  defaultExport: () => () => null,
});

mock.module("@/components/header/header-context", {
  namedExports: {
    useHeader: () => ({ breadcrumbs: [] }),
  },
});

type MockLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  children?: ReactNode;
  href: string;
};

mock.module("next/link", {
  defaultExport: ({ children, href, onClick, ...props }: MockLinkProps) =>
    createElement(
      "a",
      {
        ...props,
        href,
        onClick: (event: { defaultPrevented: boolean }) => {
          onClick?.(event as never);
          if (!event.defaultPrevented) route.push(href);
        },
      },
      children
    ),
});

const CONVERSATION_A_ID = "30000000-0000-4000-8000-000000000001";
const CONVERSATION_B_ID = "30000000-0000-4000-8000-000000000002";

function conversation(
  id: string,
  title: string,
  body: string
): PublicEvryConversation {
  return {
    id,
    title,
    createdAt: "2026-08-28T12:00:00.000Z",
    lastActivityAt: "2026-08-28T12:01:00.000Z",
    activePlan: null,
    stateVersion: 0,
    state: {},
    messages: [
      {
        id:
          id === CONVERSATION_A_ID
            ? "50000000-0000-4000-8000-000000000001"
            : "50000000-0000-4000-8000-000000000002",
        sequence: 0,
        author: "user",
        body,
        pageContext: null,
        deliveryStatus: "complete",
        createdAt: "2026-08-28T12:01:00.000Z",
        artifacts: [],
      },
    ],
  };
}

const CONVERSATION_A = conversation(
  CONVERSATION_A_ID,
  "Conversation A",
  "First request"
);
const CONVERSATION_B = conversation(
  CONVERSATION_B_ID,
  "Conversation B",
  "Second request"
);
const HISTORY_A: EvryConversationHistoryItem = {
  id: CONVERSATION_A_ID,
  title: "Conversation A",
  lastActivityAt: "2026-08-28T12:01:00.000Z",
  lastActivityLabel: "Just now",
  lastActivityTitle: "Aug 28, 2026 at 8:01 AM",
  actionableState: "ready",
};

function jsonConversation(
  status: "available" | "created",
  value: PublicEvryConversation
): Response {
  return Response.json({ status, conversation: value });
}

function streamedConversation(
  requestId: string,
  value: PublicEvryConversation
): Response {
  const events = [
    {
      type: "work",
      requestId,
      sequence: 0,
      phase: "reading",
      code: "request_accepted",
    },
    { type: "conversation", requestId, sequence: 1, conversation: value },
    { type: "complete", requestId, sequence: 2 },
  ];
  return new Response(
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    {
      headers: { "content-type": "application/x-ndjson" },
    }
  );
}

function RemountingRoute({
  Surface,
  Workspace,
  initialConversationId,
  initialNewConversation,
}: {
  Surface: typeof import("@/components/evry/conversation-surface").ConversationSurface;
  Workspace: typeof import("./conversation-history-workspace").ConversationHistoryWorkspace;
  initialConversationId: string | null;
  initialNewConversation: boolean;
}) {
  const [routeState, setRouteState] = useState({
    conversationId: initialConversationId,
    newConversation: initialNewConversation,
    revision: 0,
  });
  useEffect(() => route.observe(setRouteState), []);
  return createElement(Workspace, {
    key: routeState.revision,
    conversations: [HISTORY_A],
    conversationId: routeState.conversationId,
    conversationSurface: createElement(Surface),
    newConversation: routeState.newConversation,
    searchQuery: null,
  });
}

function newLink(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.find(
    (node) =>
      node.type === "a" && node.props["data-testid"] === "evry-history-new"
  );
}

function activate(
  link: ReactTestInstance,
  modifiers: Readonly<{
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  }> = {}
): boolean {
  let defaultPrevented = false;
  link.props.onClick?.({
    ...modifiers,
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault() {
      defaultPrevented = true;
    },
  });
  return defaultPrevented;
}

function renderedText(renderer: ReactTestRenderer, text: string): boolean {
  return (
    renderer.root.findAll((node) => node.children.includes(text)).length > 0
  );
}

function composerForm(renderer: ReactTestRenderer): ReactTestInstance {
  const form = renderer.root
    .findAllByType("form")
    .find((candidate) => candidate.findAllByType("textarea").length === 1);
  if (!form) throw new Error("Composer form was not rendered");
  return form;
}

type FocusNode = {
  connected: boolean;
  id: string | null;
  pane: "detail" | "history" | null;
  contains: (candidate: FocusNode | null) => boolean;
  focus: () => void;
  scrollIntoView: () => void;
};

test("real shell state survives stale route remounts for first and repeated New clicks", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  route.reset();
  let activeElement: FocusNode | null = null;
  const activeElementId = () => activeElement?.id ?? null;
  const focusNodes = new Map<string, FocusNode>();
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const mockHistory = { state: null };
  let replacedHref: string | null = null;
  function MockHistory() {}
  MockHistory.prototype.replaceState = (
    _state: unknown,
    _unused: string,
    href?: string | URL | null
  ) => {
    replacedHref = href === undefined || href === null ? null : String(href);
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get activeElement() {
        return activeElement;
      },
      getElementById: (id: string) => focusNodes.get(id) ?? null,
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { History: MockHistory, history: mockHistory },
  });
  t.after(() => {
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });
  let conversationLoads = 0;
  let conversationCreates = 0;
  const secondLoad = Promise.withResolvers<void>();
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/evry/conversations/${CONVERSATION_A_ID}`)) {
        conversationLoads += 1;
        if (conversationLoads === 2) {
          await secondLoad.promise;
        }
        return jsonConversation("available", CONVERSATION_A);
      }
      if (url.endsWith("/api/evry/conversations") && init?.method === "POST") {
        conversationCreates += 1;
        const body = JSON.parse(String(init.body)) as { requestKey: string };
        return streamedConversation(body.requestKey, CONVERSATION_B);
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    }
  );

  const [
    { EvryShell },
    { ConversationSurface },
    { ConversationHistoryWorkspace },
  ] = await Promise.all([
    import("@/components/evry/evry-shell"),
    import("@/components/evry/conversation-surface"),
    import("./conversation-history-workspace"),
  ]);
  const documentTree = (
    key: string,
    conversationId: string | null,
    newConversation: boolean
  ) =>
    createElement(EvryShell, {
      key,
      enabled: true,
      eligibleSuggestions: [],
      children: createElement(RemountingRoute, {
        Surface: ConversationSurface,
        Workspace: ConversationHistoryWorkspace,
        initialConversationId: conversationId,
        initialNewConversation: newConversation,
      }),
    });
  let renderer: ReactTestRenderer | null = null;
  await act(async () => {
    renderer = create(
      documentTree("conversation-a", CONVERSATION_A_ID, false),
      {
        createNodeMock: (element) => {
          const props = element.props as Record<string, unknown>;
          const id = typeof props.id === "string" ? props.id : null;
          const pane =
            props["data-focus-pane"] === "detail" ||
            props["data-focus-pane"] === "history"
              ? props["data-focus-pane"]
              : null;
          if (id === "evry-conversation-heading") {
            const status = focusNodes.get("evry-conversation-status");
            if (status) status.connected = false;
          }
          const node: FocusNode = {
            connected: true,
            id,
            pane,
            contains: (candidate) =>
              candidate?.connected === true && candidate.pane === pane,
            focus: () => {
              activeElement = node;
            },
            scrollIntoView: () => {},
          };
          if (id) focusNodes.set(id, node);
          return node;
        },
      }
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  assert.ok(renderer);
  const mountedRenderer = renderer as ReactTestRenderer;
  assert.equal(conversationLoads, 1);
  assert.equal(renderedText(mountedRenderer, "First request"), true);

  const initialForm = composerForm(mountedRenderer);
  await act(async () => {
    initialForm
      .findByType("textarea")
      .props.onChange({ target: { value: "Preserve this draft" } });
  });
  const control = newLink(mountedRenderer);
  assert.equal(control.props.href, "/evry?new=1");
  assert.equal(activate(control, { metaKey: true }), false);
  assert.equal(renderedText(mountedRenderer, "First request"), true);
  assert.equal(
    composerForm(mountedRenderer).findByType("textarea").props.value,
    "Preserve this draft"
  );

  await act(async () => {
    activeElement = {
      connected: true,
      id: "evry-history-new",
      pane: "history",
      contains: () => false,
      focus: () => {},
      scrollIntoView: () => {},
    };
    assert.equal(activate(control), false);
    mountedRenderer.update(documentTree("new-1", null, true));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.deepEqual(route.pushes, []);
  assert.equal(
    conversationLoads,
    1,
    "stale A must not reload after the workspace remounts"
  );
  assert.equal(renderedText(mountedRenderer, "First request"), false);
  assert.equal(renderedText(mountedRenderer, "New conversation"), true);
  assert.equal(activeElementId(), "evry-conversation-heading");

  const form = composerForm(mountedRenderer);
  const textarea = form.findByType("textarea");
  await act(async () => {
    textarea.props.onChange({ target: { value: "Create conversation B" } });
  });
  await act(async () => {
    form.props.onSubmit({ preventDefault: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.equal(conversationCreates, 1);
  assert.equal(renderedText(mountedRenderer, "Second request"), true);
  assert.equal(
    replacedHref,
    `/evry?conversation=${CONVERSATION_B_ID}`,
    "created conversation replaces the explicit New URL"
  );

  await act(async () => {
    const repeatedNew = newLink(mountedRenderer);
    assert.equal(repeatedNew.props.href, "/evry?new=1");
    assert.equal(activate(repeatedNew), false);
    mountedRenderer.update(documentTree("new-2", null, true));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.deepEqual(route.pushes, []);
  assert.equal(conversationLoads, 1);
  assert.equal(renderedText(mountedRenderer, "Second request"), false);

  const backButton = mountedRenderer.root.find(
    (node) =>
      node.type === "button" &&
      node.props["aria-label"] === "Back to conversations"
  );
  await act(async () => backButton.props.onClick());
  await act(async () => route.commit(null, false));
  assert.equal(activeElementId(), "evry-history-heading");

  const row = mountedRenderer.root.find(
    (node) =>
      node.type === "a" &&
      node.props["data-testid"] === `evry-history-row-${CONVERSATION_A_ID}`
  );
  await act(async () => {
    activate(row);
  });
  await act(async () => route.commit(CONVERSATION_A_ID, false));
  const openingStatus = mountedRenderer.root.findByProps({
    id: "evry-conversation-status",
  });
  assert.equal(openingStatus.props.role, undefined);
  assert.equal(openingStatus.props["aria-live"], undefined);
  assert.equal(openingStatus.props["aria-busy"], undefined);
  assert.equal(
    openingStatus.findAll(
      (node) => node.props.role === "status" || node.props.role === "alert"
    ).length,
    0,
    "history handoff must not compete with the stable work-status live regions"
  );
  assert.equal(activeElementId(), "evry-conversation-status");
  secondLoad.resolve();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  assert.equal(conversationLoads, 2);
  assert.equal(renderedText(mountedRenderer, "First request"), true);
  assert.equal(activeElementId(), "evry-conversation-heading");
  assert.deepEqual(route.pushes, [
    "/evry",
    `/evry?conversation=${CONVERSATION_A_ID}`,
  ]);

  await act(async () => mountedRenderer.unmount());
});
