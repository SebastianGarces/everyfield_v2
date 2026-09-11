import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { EVRY_CONFIRMATION_FIXTURES } from "@/lib/evry/artifacts/fixtures";

type FocusNode = {
  focus(): void;
};

let resolveAction:
  | ((result: {
      status: "conversation";
      conversation: Record<string, unknown>;
    }) => void)
  | null = null;
const workStates: Array<{ phase: string; message?: string }> = [];
const conversations: Record<string, unknown>[] = [];
let shellIsWorking = false;
let refreshes = 0;

mock.module("@/components/evry/evry-shell", {
  namedExports: {
    useEvryShell: () => ({
      isWorking: shellIsWorking,
      beginWork(
        _requestId: string,
        state: { phase: string; message?: string }
      ) {
        workStates.push(state);
      },
      observeWork() {},
      updateWork(
        _requestId: string,
        _sequence: number,
        state: { phase: string; message?: string }
      ) {
        workStates.push(state);
        return true;
      },
      finishWork() {
        return true;
      },
      applyWorkConversation(
        _requestId: string,
        _sequence: number,
        conversation: Record<string, unknown>
      ) {
        conversations.push(conversation);
        return true;
      },
    }),
  },
});
mock.module("next/link", {
  defaultExport: ({ children, ...props }: { children: ReactNode }) =>
    createElement("a", props, children),
});
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({
      refresh() {
        refreshes += 1;
      },
    }),
  },
});
mock.module("@/components/evry/artifacts/production-request", {
  namedExports: {
    coordinateEvryProductionArtifactRequest: () =>
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
  },
});

function hasText(renderer: ReactTestRenderer, text: string): boolean {
  return (
    renderer.root.findAll((node) => node.children.includes(text)).length > 0
  );
}

test("execution moves focus once when confirmation controls unmount and leaves it stable", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  let activeElement: FocusNode | null = null;
  const statusNode: FocusNode = {
    focus() {
      activeElement = statusNode;
    },
  };
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
        return id === "evry-work-status" ? statusNode : null;
      },
    },
  });
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  Object.assign(globalThis, {
    requestAnimationFrame(callback: FrameRequestCallback) {
      callback(0);
      return 1;
    },
  });
  t.after(() => {
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    Object.assign(globalThis, {
      requestAnimationFrame: originalAnimationFrame,
    });
  });

  const { EvryProductionArtifact } =
    await import("@/components/evry/artifacts/production-artifact");
  const confirmation = EVRY_CONFIRMATION_FIXTURES.meeting;
  const artifactElement = ({
    stateVersion = 1,
    planStatus = "awaiting_confirmation",
  }: {
    stateVersion?: number;
    planStatus?: "awaiting_confirmation" | "completed";
  } = {}) =>
    createElement(EvryProductionArtifact, {
      artifact: confirmation,
      activePlan: {
        identity: confirmation.plan,
        status: planStatus,
        expiresAt: "2026-08-28T13:00:00.000Z",
        confirmable: planStatus === "awaiting_confirmation",
      },
      artifactId: "20000000-0000-4000-8000-000000000001",
      conversationId: "30000000-0000-4000-8000-000000000001",
      conversationStateVersion: stateVersion,
      interactive: true,
      messageId: "40000000-0000-4000-8000-000000000001",
      onEdit() {},
    });
  let renderer: ReactTestRenderer | null = null;
  await act(() => {
    renderer = create(artifactElement(), {
      createNodeMock(element) {
        if (element.type !== "button") return {};
        const node: FocusNode = {
          focus() {
            activeElement = node;
          },
        };
        return node;
      },
    });
  });
  assert.ok(renderer);
  const mounted = renderer as ReactTestRenderer;
  shellIsWorking = true;
  await act(() => mounted.update(artifactElement()));
  assert.equal(hasText(mounted, confirmation.actionLabel), false);
  shellIsWorking = false;
  await act(() => mounted.update(artifactElement()));
  const execute = mounted.root.find(
    (node) =>
      node.type === "button" && node.children.includes(confirmation.actionLabel)
  );
  const executeNode = execute.instance as FocusNode;
  executeNode.focus();
  assert.equal(activeElement, executeNode);

  await act(async () => {
    execute.props.onClick();
    await Promise.resolve();
  });

  assert.equal(hasText(mounted, confirmation.actionLabel), false);
  assert.equal(hasText(mounted, "Running: " + confirmation.title), true);
  assert.equal(workStates.at(-1)?.phase, "execution");
  assert.equal(activeElement, statusNode);

  await act(() =>
    mounted.update(
      artifactElement({ stateVersion: 2, planStatus: "completed" })
    )
  );
  assert.equal(hasText(mounted, "Running: " + confirmation.title), false);
  assert.equal(activeElement, statusNode);

  const reconciled = {
    id: "30000000-0000-4000-8000-000000000001",
  };
  resolveAction?.({ status: "conversation", conversation: reconciled });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.deepEqual(conversations, [reconciled]);
  assert.equal(refreshes, 1);
  assert.equal(activeElement, statusNode);
});
