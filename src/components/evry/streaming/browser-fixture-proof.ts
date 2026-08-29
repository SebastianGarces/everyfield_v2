import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

mock.module("next/link", {
  defaultExport: ({ children, ...props }: { children: ReactNode }) =>
    createElement("a", props, children),
});

type FocusNode = {
  id: string | null;
  focus(): void;
};

function hasText(renderer: ReactTestRenderer, text: string): boolean {
  return (
    renderer.root.findAll((node) => node.children.includes(text)).length > 0
  );
}

function button(renderer: ReactTestRenderer, text: string) {
  return renderer.root.find(
    (node) =>
      node.type === "button" &&
      node.children
        .filter((child): child is string => typeof child === "string")
        .join("") === text
  );
}

test("the preview fixture completes its keyboard lifecycle with one announcement owner", async (t) => {
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  const scheduled: Array<() => void> = [];
  t.mock.method(globalThis, "setTimeout", ((callback: () => void) => {
    scheduled.push(callback);
    return scheduled.length;
  }) as typeof setTimeout);
  t.mock.method(globalThis, "clearTimeout", (() => {}) as typeof clearTimeout);

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
        const existing = nodes.get(id);
        if (existing) return existing;
        const node: FocusNode = {
          id,
          focus() {
            activeElement = node;
          },
        };
        nodes.set(id, node);
        return node;
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

  const { EvryStreamingBrowserFixture } = await import("./browser-fixture");
  let renderer: ReactTestRenderer | null = null;
  await act(() => {
    renderer = create(createElement(EvryStreamingBrowserFixture), {
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
        };
        if (id) nodes.set(id, node);
        return node;
      },
    });
  });
  assert.ok(renderer);
  const mounted = renderer as ReactTestRenderer;
  const polite = mounted.root.findByProps({ role: "status" });
  const assertive = mounted.root.findByProps({ role: "alert" });
  const requestInput = mounted.root.find(
    (node) =>
      node.type === "input" && node.props.id === "streaming-fixture-request"
  );
  const requestForm = mounted.root.find(
    (node) =>
      node.type === "form" &&
      node.findAll(
        (candidate) =>
          candidate.type === "input" &&
          candidate.props.id === "streaming-fixture-request"
      ).length === 1
  );
  requestInput.instance.focus();

  await act(() => {
    requestForm.props.onSubmit({ preventDefault() {} });
  });
  assert.equal(hasText(mounted, "Reading people and meeting details"), true);
  assert.equal(activeElement, requestInput.instance);
  assert.equal(mounted.root.findAllByProps({ role: "status" }).length, 1);
  assert.equal(mounted.root.findAllByProps({ role: "alert" }).length, 1);
  assert.equal(mounted.root.findByProps({ role: "status" }), polite);
  assert.equal(mounted.root.findByProps({ role: "alert" }), assertive);

  await act(() => scheduled.shift()?.());
  assert.equal(hasText(mounted, "Which Taylor should join the meeting?"), true);
  await act(() => button(mounted, "Choose Taylor Adams").props.onClick());
  assert.equal(activeElement, nodes.get("evry-work-status"));
  assert.equal(hasText(mounted, "Building a three-step meeting plan"), true);

  await act(() => scheduled.shift()?.());
  assert.equal(hasText(mounted, "Review before Evry acts"), true);
  await act(() => button(mounted, "Edit plan").props.onClick());
  assert.equal(activeElement, nodes.get("streaming-fixture-recipient"));
  mounted.root.find(
    (node) =>
      node.type === "input" && node.props.id === "streaming-fixture-recipient"
  );
  const recipientForm = mounted.root.find(
    (node) =>
      node.type === "form" &&
      node.findAll(
        (candidate) =>
          candidate.type === "input" &&
          candidate.props.id === "streaming-fixture-recipient"
      ).length === 1
  );
  await act(async () => {
    recipientForm.props.onSubmit({ preventDefault() {} });
    await Promise.resolve();
  });
  assert.equal(activeElement, nodes.get("evry-work-status"));
  await act(() => scheduled.shift()?.());

  await act(() => button(mounted, "Create meeting and send 4").props.onClick());
  assert.equal(activeElement, nodes.get("evry-work-status"));
  assert.equal(
    hasText(mounted, "Creating the meeting and sending invitations"),
    true
  );
  await act(() => scheduled.shift()?.());
  assert.equal(
    hasText(mounted, "Meeting created; invitations need attention"),
    true
  );
  assert.equal(
    hasText(
      mounted,
      "Meeting completed, but invitation delivery needs attention. Review the receipt before retrying."
    ),
    true
  );
  assert.equal(mounted.root.findAllByProps({ role: "status" }).length, 1);
  assert.equal(mounted.root.findAllByProps({ role: "alert" }).length, 1);
  assert.equal(mounted.root.findByProps({ role: "status" }), polite);
  assert.equal(mounted.root.findByProps({ role: "alert" }), assertive);
  assert.equal(activeElement, nodes.get("evry-work-status"));
  assert.equal(
    mounted.root.findByProps({ id: "evry-work-status" }).parent?.props[
      "aria-busy"
    ],
    undefined
  );
});
