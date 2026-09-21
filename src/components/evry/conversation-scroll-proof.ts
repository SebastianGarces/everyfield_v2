import assert from "node:assert/strict";
import { mock, test, type TestContext } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { EveMessage } from "eve/client";
import { z } from "zod";
import type { useEvryShell } from "./evry-shell";
import { eveResultMarker } from "@/lib/evry/eve/presentation";

type Shell = ReturnType<typeof useEvryShell>;
const emptyShell = () => ({
  activeContext: null,
  acknowledgement: null,
  canStopWatching: false,
  clearContext() {},
  conversation: null as Shell["conversation"],
  messages: [] as EveMessage[],
  draft: "",
  pendingMessage: null,
  discardPendingMessage() {},
  error: null,
  isComposerBlocked: false,
  isLoading: false,
  isRestoringHistory: false,
  isSending: false,
  isWatchingDetached: false,
  resumeWatching() {},
  recoveryLabel: "Retry",
  sendMessage: async () => {},
  setDraft() {},
  stopWatching() {},
  workRequestId: null as string | null,
  workState: { phase: "idle" } as Shell["workState"],
});
let shell = emptyShell();
mock.module("./evry-shell", { namedExports: { useEvryShell: () => shell } });
mock.module("./people-file-workflow", {
  namedExports: { EvryPeopleFileWorkflow: () => null },
});
mock.module("./eve-client/question-options", {
  namedExports: { EveQuestionOptions: () => null },
});
mock.module("./artifacts/production-artifact", {
  namedExports: {
    EvryProductionArtifact: () =>
      createElement("div", null, "Saved result card"),
  },
});

const conversation = (id: string): NonNullable<Shell["conversation"]> => ({
  id,
  title: "Launch progress",
  createdAt: "2026-09-20T16:00:00Z",
  lastActivityAt: "2026-09-20T16:00:00Z",
  activePlan: null,
  stateVersion: 0,
  state: null,
  messages: [],
});
const message = (
  role: "user" | "assistant",
  turnId: string,
  text: string,
  streaming = false
): EveMessage => ({
  id: `${turnId}:${role}`,
  role,
  metadata: { turnId, status: streaming ? "streaming" : "complete" },
  parts: [{ type: "text", text }],
});

function withCards(reply: EveMessage): EveMessage {
  return {
    ...reply,
    parts: [
      ...reply.parts,
      {
        type: "dynamic-tool",
        toolName: "people_query",
        toolCallId: "saved-result",
        state: "output-available",
        input: {},
        output: z.json().parse({
          data: { resultReference: "saved-result" },
          presentation: {
            version: 1,
            turnId: reply.metadata?.turnId,
            results: [
              {
                reference: "saved-result",
                artifacts: Array.from({ length: 5 }, (_, index) => ({
                  kind: "read",
                  title: `Launch detail ${index + 1}`,
                  resultMode: "list",
                  filters: [],
                  counts: { matched: 0, returned: 0, excluded: 0 },
                  exclusions: [],
                  items: [],
                  sourceLinks: [],
                })),
              },
            ],
          },
        }),
      },
      { type: "text", text: `\n\n${eveResultMarker("saved-result")}` },
    ],
  };
}
const jumpButtons = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) => node.type === "button" && node.children.includes("Jump to latest")
  );

async function mount(t: TestContext) {
  const { ConversationSurface } = await import("./conversation-surface");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      process.stderr.write(`${args.join(" ")}\n`);
  });
  shell = emptyShell();
  let height = 631,
    responseTop = 200,
    responseHeight = 40,
    composerHeight = 100,
    top = 0;
  const positions: number[] = [];
  const resizeCallbacks = new Set<() => void>();
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Scroll proof must not use network");
  });
  const previousResize = Object.getOwnPropertyDescriptor(
    globalThis,
    "ResizeObserver"
  );
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(private callback: () => void) {
        resizeCallbacks.add(callback);
      }
      observe() {}
      disconnect() {
        resizeCallbacks.delete(this.callback);
      }
    },
  });
  const rect = (rectTop: number, rectHeight: number) => ({
    top: rectTop,
    bottom: rectTop + rectHeight,
    height: rectHeight,
  });
  const transcript = {
    get scrollHeight() {
      return height;
    },
    clientHeight: 631,
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.max(0, Math.min(value, height - 631));
      positions.push(top);
    },
    getBoundingClientRect: () => rect(0, 631),
  };
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(createElement(ConversationSurface), {
      createNodeMock(element) {
        const props = z
          .object({
            "data-slot": z.string().optional(),
            "data-response-start": z.string().optional(),
          })
          .passthrough()
          .parse(element.props);
        if (props["data-slot"] === "evry-transcript") return transcript;
        if (props["data-slot"] === "evry-composer")
          return {
            get offsetHeight() {
              return composerHeight;
            },
            getBoundingClientRect: () =>
              rect(631 - composerHeight, composerHeight),
          };
        if (props["data-slot"] === "evry-content-end")
          return { getBoundingClientRect: () => rect(height - 170 - top, 0) };
        if (props["data-response-start"])
          return {
            getBoundingClientRect: () =>
              rect(responseTop - top, responseHeight),
          };
        return {
          style: { setProperty() {} },
          getBoundingClientRect: () => rect(0, height),
        };
      },
    });
  });
  assert.ok(renderer);
  const mounted = renderer;
  t.after(async () => {
    await act(() => mounted.unmount());
    if (previousResize)
      Object.defineProperty(globalThis, "ResizeObserver", previousResize);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  });
  return {
    transcript,
    positions,
    renderer: mounted,
    async render(
      next: Partial<typeof shell>,
      geometry?: {
        height?: number;
        responseTop?: number;
        responseHeight?: number;
        composerHeight?: number;
      }
    ) {
      shell = { ...shell, ...next };
      height = geometry?.height ?? height;
      responseTop = geometry?.responseTop ?? responseTop;
      responseHeight = geometry?.responseHeight ?? responseHeight;
      composerHeight = geometry?.composerHeight ?? composerHeight;
      await act(() => mounted.update(createElement(ConversationSurface)));
      await act(() => {
        for (const callback of resizeCallbacks) callback();
      });
    },
  };
}

test("saved metadata before replay must not consume initial bottom positioning", async (t) => {
  const view = await mount(t);
  // loadConversation commits metadata + client=null + loading=false before the bridge resumes.
  await view.render({ conversation: conversation("saved-launch") });
  await view.render({ isLoading: true });
  await view.render(
    {
      isLoading: false,
      messages: [
        message("user", "saved", "Where are we on launch?"),
        withCards(
          message(
            "assistant",
            "saved",
            "Launch progress with five saved cards."
          )
        ),
      ],
      workRequestId: "saved",
    },
    { height: 3299, responseTop: 200, responseHeight: 2900 }
  );
  assert.equal(
    view.transcript.scrollTop,
    3299 - 631,
    "Open saved history at its bottom, not the final answer's beginning"
  );
  assert.equal(jumpButtons(view.renderer).length, 0);
});

test("switching saved conversations resets initial positioning even after reading older messages", async (t) => {
  const view = await mount(t);
  await view.render(
    {
      conversation: conversation("a"),
      messages: [message("assistant", "a", "Saved A")],
      workRequestId: "a",
    },
    { height: 2000 }
  );
  view.transcript.scrollTop = 120;
  view.renderer.root
    .findByProps({ "data-slot": "evry-transcript" })
    .props.onWheel();
  await view.render({
    conversation: conversation("b"),
    messages: [],
    workRequestId: null,
  });
  await view.render(
    { messages: [message("assistant", "b", "Saved B")], workRequestId: "b" },
    { height: 3299, responseTop: 150, responseHeight: 3000 }
  );
  assert.equal(view.transcript.scrollTop, 2668);
});

test("a visible new response stays put through text, cards, completion and composer resize", async (t) => {
  const view = await mount(t);
  await view.render({
    conversation: conversation("a"),
    messages: [message("assistant", "old", "Previous answer")],
    workRequestId: "old",
  });
  await view.render(
    {
      messages: [
        ...shell.messages,
        message("user", "new", "Show launch status"),
      ],
      workRequestId: "new",
    },
    { height: 900 }
  );
  const readingPosition = view.transcript.scrollTop;
  await view.render(
    {
      messages: [
        ...shell.messages,
        message("assistant", "new", "Starting…", true),
      ],
    },
    { responseTop: readingPosition + 100 }
  );
  assert.equal(view.transcript.scrollTop, readingPosition);
  const writes = view.positions.length;
  await view.render(
    {
      messages: [
        message("user", "new", "Show launch status"),
        withCards(
          message("assistant", "new", "Long streaming answer with cards", true)
        ),
      ],
    },
    { height: 3600, responseHeight: 3100, composerHeight: 160 }
  );
  await view.render({
    messages: [
      message("user", "new", "Show launch status"),
      message("assistant", "new", "Completed answer and cards"),
    ],
  });
  assert.equal(view.transcript.scrollTop, readingPosition);
  assert.equal(
    view.positions.length,
    writes,
    "Growth/resize/completion must not follow the reply"
  );
  assert.equal(jumpButtons(view.renderer).length, 1);
});

test("an offscreen new beginning is revealed once unless the reader moved while waiting", async (t) => {
  const view = await mount(t);
  await view.render(
    {
      conversation: conversation("a"),
      messages: [message("user", "new", "Question")],
      workRequestId: "new",
    },
    { height: 1200 }
  );
  const initial = view.transcript.scrollTop;
  await view.render(
    {
      messages: [
        ...shell.messages,
        message("assistant", "new", "Answer", true),
      ],
    },
    { height: 1800, responseTop: initial + 800, responseHeight: 30 }
  );
  assert.ok(view.transcript.scrollTop > initial);
  const positioned = view.transcript.scrollTop;
  await view.render(
    {
      messages: [
        message("user", "new", "Question"),
        message("assistant", "new", "Long answer", true),
      ],
    },
    { height: 3000, responseHeight: 2000 }
  );
  assert.equal(view.transcript.scrollTop, positioned);
  await view.render({
    messages: [...shell.messages, message("user", "next", "Another question")],
    workRequestId: "next",
  });
  view.transcript.scrollTop = 100;
  view.renderer.root
    .findByProps({ "data-slot": "evry-transcript" })
    .props.onWheel();
  await view.render(
    {
      messages: [
        ...shell.messages,
        message("assistant", "next", "Another answer", true),
      ],
    },
    { height: 4200, responseTop: 3400 }
  );
  assert.equal(view.transcript.scrollTop, 100);
});

test("slow history replay waits for the final restored frame, not the first message", async (t) => {
  const view = await mount(t);
  await view.render({
    conversation: conversation("chunked"),
    isRestoringHistory: true,
  });
  await view.render({
    messages: [message("user", "old", "Old question")],
    workRequestId: "old",
  });
  await view.render(
    {
      messages: [...shell.messages, message("assistant", "old", "Old answer")],
    },
    { height: 1000, responseTop: 150 }
  );
  await view.render(
    {
      messages: [
        ...shell.messages,
        message("user", "latest", "Where are we on launch?"),
        withCards(message("assistant", "latest", "Saved launch answer")),
      ],
      workRequestId: "latest",
    },
    { height: 3299, responseTop: 1200, responseHeight: 1800 }
  );
  await view.render({ isRestoringHistory: false });
  assert.equal(
    view.transcript.scrollTop,
    2668,
    "Finishing native replay positions the final restored transcript"
  );
});

test("a newly created conversation adopts the live request without moving its visible reply", async (t) => {
  const view = await mount(t);
  await view.render(
    { messages: [message("user", "new", "Question")], workRequestId: "new" },
    { height: 800 }
  );
  const initial = view.transcript.scrollTop;
  await view.render(
    {
      messages: [
        ...shell.messages,
        message("assistant", "new", "Answer starts", true),
      ],
    },
    { responseTop: initial + 100 }
  );
  await view.render(
    { conversation: conversation("newly-saved") },
    { height: 3000, responseHeight: 2500 }
  );
  assert.equal(view.transcript.scrollTop, initial);
});

test("jump-to-latest is absent when content fits and does not enable streaming follow", async (t) => {
  const view = await mount(t);
  await view.render({
    conversation: conversation("short"),
    messages: [message("assistant", "short", "Short answer")],
    workRequestId: "short",
  });
  assert.equal(jumpButtons(view.renderer).length, 0);
  await view.render({
    messages: [...shell.messages, message("user", "long", "Another question")],
    workRequestId: "long",
  });
  await view.render(
    {
      messages: [
        ...shell.messages,
        message("assistant", "long", "Long reply", true),
      ],
    },
    { height: 3000, responseTop: 100, responseHeight: 2500 }
  );
  assert.equal(jumpButtons(view.renderer).length, 1);
  await act(() => jumpButtons(view.renderer)[0]!.props.onClick());
  const jumped = view.transcript.scrollTop;
  assert.equal(jumped, 2369);
  await view.render(
    {
      messages: [
        message("user", "long", "Another question"),
        message("assistant", "long", "Longer reply", true),
      ],
    },
    { height: 4000, responseHeight: 3500 }
  );
  assert.equal(view.transcript.scrollTop, jumped);
  assert.equal(jumpButtons(view.renderer).length, 1);
});

test("expanding an active panel opens at the current bottom then stops following", async (t) => {
  const view = await mount(t);
  await view.render(
    {
      conversation: conversation("active-panel"),
      messages: [
        message("user", "active", "Launch progress?"),
        withCards(message("assistant", "active", "Progress so far", true)),
      ],
      workRequestId: "active",
    },
    { height: 3299, responseTop: 200, responseHeight: 2800 }
  );
  assert.equal(view.transcript.scrollTop, 2668);
  await view.render(
    {
      messages: [
        message("user", "active", "Launch progress?"),
        withCards(message("assistant", "active", "More progress", true)),
      ],
    },
    { height: 4000, responseHeight: 3500 }
  );
  assert.equal(view.transcript.scrollTop, 2668);
});

test("switching away from an active answer positions only the selected restored conversation", async (t) => {
  const view = await mount(t);
  await view.render(
    {
      conversation: conversation("active"),
      messages: [message("assistant", "active", "Streaming", true)],
      workRequestId: "active",
    },
    { height: 1800 }
  );
  await view.render({ isLoading: true, isRestoringHistory: true });
  await view.render({
    conversation: conversation("selected"),
    messages: [],
    workRequestId: null,
    isLoading: false,
  });
  await view.render(
    {
      messages: [message("assistant", "selected", "Saved launch answer")],
      workRequestId: "selected",
    },
    { height: 3299, responseTop: 150, responseHeight: 2900 }
  );
  await view.render({ isRestoringHistory: false });
  assert.equal(view.transcript.scrollTop, 2668);
});
