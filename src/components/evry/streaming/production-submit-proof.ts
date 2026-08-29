import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const emptySearchParams = new URLSearchParams();

mock.module("next/navigation", {
  namedExports: {
    usePathname: () => "/dashboard",
    useSearchParams: () => emptySearchParams,
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

type FocusNode = {
  id: string | null;
  focus(): void;
  contains(candidate: FocusNode | null): boolean;
  scrollIntoView(): void;
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
};

function renderedText(renderer: ReactTestRenderer, value: string): boolean {
  return (
    renderer.root.findAll((node) => node.children.includes(value)).length > 0
  );
}

test("the real composer commits a request-keyed acknowledgement before its POST resolves", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  let activeElement: FocusNode | null = null;
  const nodes = new Map<string, FocusNode>();
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
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
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  });

  const measures: Array<{
    name: string;
    options: PerformanceMeasureOptions;
  }> = [];
  let clockCalls = 0;
  t.mock.method(performance, "now", () => (clockCalls++ === 0 ? 100 : 180));
  t.mock.method(
    performance,
    "measure",
    (name: string, options?: PerformanceMeasureOptions) => {
      measures.push({ name, options: options! });
      return {} as PerformanceMeasure;
    }
  );

  let resolvePost: ((response: Response) => void) | null = null;
  let postedRequestId: string | null = null;
  const postedUrls: string[] = [];
  const postedRequestIds: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        const body = JSON.parse(String(init?.body)) as { requestKey: string };
        postedRequestId = body.requestKey;
        postedRequestIds.push(body.requestKey);
        postedUrls.push(String(input));
        assert.equal(
          new Headers(init?.headers).get("accept"),
          "application/x-ndjson"
        );
        resolvePost = resolve;
      })
  );

  const [{ EvryShell, useEvryShell }, { ConversationSurface }] =
    await Promise.all([
      import("@/components/evry/evry-shell"),
      import("@/components/evry/conversation-surface"),
    ]);
  const workSnapshots: boolean[] = [];
  function SurfaceWithWorkProbe() {
    const shell = useEvryShell();
    workSnapshots.push(shell.isWorking);
    return createElement(ConversationSurface);
  }
  let renderer: ReactTestRenderer | null = null;
  await act(() => {
    renderer = create(
      createElement(EvryShell, {
        enabled: true,
        eligibleSuggestions: [
          {
            id: "people-follow-up",
            module: "people",
            request: "Show me who needs follow-up",
            fallback: true,
          },
        ],
        children: createElement(SurfaceWithWorkProbe),
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
  });
  assert.ok(renderer);
  const mounted = renderer as ReactTestRenderer;
  assert.equal(renderedText(mounted, "Show me who needs follow-up"), true);
  const polite = mounted.root.findByProps({ role: "status" });
  const textarea = mounted.root.findByType("textarea");
  const composerIsBusy = () =>
    mounted.root.findByType("textarea").props["aria-busy"] === true;
  textarea.instance.focus();
  await act(() => {
    textarea.props.onChange({ target: { value: "Find people to follow up" } });
  });
  const form = mounted.root.find(
    (node) =>
      node.type === "form" && node.findAllByType("textarea").length === 1
  );

  await act(async () => {
    form.props.onSubmit({ preventDefault() {} });
    await Promise.resolve();
  });

  assert.equal(textarea.props["aria-busy"], true);
  assert.equal(workSnapshots.at(-1), true);
  assert.equal(renderedText(mounted, "Checking this conversation"), true);
  assert.equal(renderedText(mounted, "Show me who needs follow-up"), false);
  assert.equal(mounted.root.findByProps({ role: "status" }), polite);
  for (let ancestor = polite.parent; ancestor; ancestor = ancestor.parent) {
    assert.notEqual(ancestor.props["aria-busy"], true);
  }
  assert.equal(activeElement, textarea.instance);
  const acknowledgementMeasures = measures.filter(
    ({ name }) => name === "evry.acknowledgement"
  );
  assert.equal(acknowledgementMeasures.length, 1);
  const acknowledgementStart = Number(
    acknowledgementMeasures[0]?.options.start
  );
  const acknowledgementEnd = Number(acknowledgementMeasures[0]?.options.end);
  assert.equal(Number.isFinite(acknowledgementStart), true);
  assert.equal(Number.isFinite(acknowledgementEnd), true);
  assert.equal(acknowledgementEnd >= acknowledgementStart, true);
  assert.equal(acknowledgementEnd - acknowledgementStart <= 250, true);
  assert.match(
    (acknowledgementMeasures[0]?.options.detail as { requestId: string })
      .requestId,
    /^[0-9a-f-]{36}$/
  );

  const nextConversation = {
    id: "20000000-0000-4000-8000-000000000001",
    title: "Find people to follow up",
    createdAt: "2026-08-28T12:00:00.000Z",
    lastActivityAt: "2026-08-28T12:00:00.000Z",
    activePlan: null,
    stateVersion: 0,
    state: {},
    messages: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        sequence: 0,
        author: "user",
        body: "Find people to follow up",
        pageContext: null,
        deliveryStatus: "complete",
        createdAt: "2026-08-28T12:00:00.000Z",
        artifacts: [],
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        sequence: 1,
        author: "assistant",
        body: "Which Taylor should join the meeting?",
        pageContext: null,
        deliveryStatus: "complete",
        createdAt: "2026-08-28T12:00:01.000Z",
        artifacts: [
          {
            id: "40000000-0000-4000-8000-000000000001",
            ordinal: 0,
            artifact: {
              kind: "clarification",
              mode: "choice",
              entityType: "person",
              prompt: "Which Taylor should join the meeting?",
              choices: [
                {
                  entityType: "person",
                  id: "50000000-0000-4000-8000-000000000001",
                  label: "Taylor Adams",
                  distinguishingFacts: [{ label: "Team", value: "Launch" }],
                  sourceLink: {
                    label: "Taylor Adams",
                    href: "/people/50000000-0000-4000-8000-000000000001",
                  },
                },
                {
                  entityType: "person",
                  id: "50000000-0000-4000-8000-000000000002",
                  label: "Taylor Brooks",
                  distinguishingFacts: [{ label: "Team", value: "Core group" }],
                  sourceLink: {
                    label: "Taylor Brooks",
                    href: "/people/50000000-0000-4000-8000-000000000002",
                  },
                },
              ],
              defaultChoiceId: null,
            },
          },
        ],
      },
    ],
  };
  await act(() => {
    assert.ok(postedRequestId);
    const events = [
      {
        type: "work",
        requestId: postedRequestId,
        sequence: 0,
        phase: "reading",
        code: "request_accepted",
      },
      {
        type: "work",
        requestId: postedRequestId,
        sequence: 1,
        phase: "planning",
        code: "compiling_response",
      },
      {
        type: "conversation",
        requestId: postedRequestId,
        sequence: 2,
        conversation: nextConversation,
      },
    ];
    resolvePost?.(
      new Response(
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        {
          headers: { "content-type": "application/x-ndjson" },
        }
      )
    );
  });
  for (let attempt = 0; attempt < 20 && composerIsBusy(); attempt++) {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
  assert.equal(composerIsBusy(), false);
  assert.equal(workSnapshots.at(-1), false);
  assert.equal(
    renderedText(
      mounted,
      "Unable to save your request. Check your connection and try again."
    ),
    true
  );
  assert.equal(textarea.props.value, "Find people to follow up");
  assert.equal(
    renderedText(mounted, "Which Taylor should join the meeting?"),
    true,
    "the durable frame is presented even though its terminal frame was lost"
  );
  assert.deepEqual(postedUrls, ["/api/evry/conversations"]);

  await act(async () => {
    form.props.onSubmit({ preventDefault() {} });
    await Promise.resolve();
  });
  assert.equal(composerIsBusy(), true);
  assert.deepEqual(postedUrls, [
    "/api/evry/conversations",
    "/api/evry/conversations",
  ]);
  assert.equal(postedRequestIds[1], postedRequestIds[0]);

  await act(() => {
    assert.ok(postedRequestId);
    const events = [
      {
        type: "work",
        requestId: postedRequestId,
        sequence: 0,
        phase: "reading",
        code: "request_accepted",
      },
      {
        type: "work",
        requestId: postedRequestId,
        sequence: 1,
        phase: "planning",
        code: "compiling_response",
      },
      {
        type: "conversation",
        requestId: postedRequestId,
        sequence: 2,
        conversation: nextConversation,
      },
      { type: "complete", requestId: postedRequestId, sequence: 3 },
    ];
    resolvePost?.(
      new Response(
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        {
          headers: { "content-type": "application/x-ndjson" },
        }
      )
    );
  });
  for (let attempt = 0; attempt < 20 && composerIsBusy(); attempt++) {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
  assert.equal(composerIsBusy(), false);
  assert.equal(workSnapshots.at(-1), false);
  assert.equal(renderedText(mounted, "Request saved."), true);
  assert.equal(mounted.root.findByProps({ role: "status" }), polite);
  assert.equal(activeElement, textarea.instance);
  assert.equal(
    mounted.root.findByProps({ role: "log" }).props["aria-live"],
    "off"
  );
  assert.equal(
    renderedText(mounted, "Which Taylor should join the meeting?"),
    true
  );
  await act(() => {
    textarea.props.onChange({ target: { value: "Taylor Adams" } });
  });
  assert.equal(textarea.props.value, "Taylor Adams");
  assert.equal(activeElement, textarea.instance);
});
