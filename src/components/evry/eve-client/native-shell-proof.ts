import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

let pathname = "/dashboard";
mock.module("next/navigation", {
  namedExports: {
    usePathname: () => pathname,
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push() {}, back() {}, refresh() {} }),
  },
});
mock.module("next/dynamic", { defaultExport: () => () => null });
mock.module("@/components/header/header-context", {
  namedExports: { useHeader: () => ({ breadcrumbs: [] }) },
});

test("native Eve store shows an optimistic message before acceptance and streams without replacing the session", async (t) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  t.mock.method(console, "error", (...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated"))
      process.stderr.write(args.map(String).join(" ") + "\n");
  });
  const posts: { url: string; body: unknown }[] = [];
  const accept = Promise.withResolvers<Response>();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const bytes = new TextEncoder();
  const metadata = {
    id: "eve-native-test",
    conversationId: "10000000-0000-4000-8000-000000000001",
    title: "Launch progress",
    createdAt: "2026-09-20T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/evry/eve/sessions"))
        return Response.json({ session: metadata });
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return accept.promise;
      }
      assert.match(url, /\/eve\/v1\/session\/eve-native-test\/stream/);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
        },
      });
      return new Response(body, {
        headers: {
          "x-eve-stream-version": "25",
          "x-eve-stream-tail-index": "-1",
          "content-type": "application/x-ndjson",
        },
      });
    }
  );
  const { EvryShell, useEvryShell } = await import("../evry-shell");
  let shell!: ReturnType<typeof useEvryShell>;
  function Probe() {
    const value = useEvryShell();
    useEffect(() => {
      shell = value;
    }, [value]);
    return createElement(
      "div",
      null,
      value.messages.map((message) =>
        createElement(
          "p",
          { key: message.id },
          message.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("")
        )
      )
    );
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      createElement(EvryShell, {
        enabled: true,
        children: createElement(Probe),
      })
    );
  });
  t.after(async () => {
    await act(() => renderer.unmount());
  });
  let sending!: Promise<void>;
  await act(async () => {
    sending = shell.sendMessageText("Where are we on launch?");
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.url, "/eve/v1/session");
  assert.equal(shell.messages.length, 1);
  assert.equal(shell.messages[0]!.metadata?.optimistic, true);
  assert.equal(shell.isWorking, true);
  assert(shell.acknowledgement);
  assert.match(JSON.stringify(renderer.toJSON()), /Where are we on launch/);
  await act(async () => {
    accept.resolve(Response.json({ sessionId: metadata.id }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.equal(shell.conversation?.id, metadata.conversationId);
  let eventIndex = 0;
  const emit = (type: string, data: object) =>
    stream.enqueue(
      bytes.encode(
        JSON.stringify({ type, data, meta: { id: `event-${eventIndex++}` } }) +
          "\n"
      )
    );
  await act(async () => {
    emit("session.started", {});
    emit("turn.started", { sequence: 1, turnId: "turn-1" });
    emit("message.received", {
      sequence: 1,
      turnId: "turn-1",
      message: "Where are we on launch?",
    });
    emit("message.appended", {
      sequence: 1,
      stepIndex: 0,
      turnId: "turn-1",
      messageDelta: "Five milestones remain.",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.equal(
    shell.messages.filter((message) => message.role === "user").length,
    1
  );
  assert.match(JSON.stringify(renderer.toJSON()), /Five milestones remain/);
  const session = shell.sessionId;
  pathname = "/tasks";
  await act(() =>
    renderer.update(
      createElement(EvryShell, {
        enabled: true,
        children: createElement(Probe),
      })
    )
  );
  assert.equal(shell.sessionId, session);
  assert.equal(posts.length, 1, "navigation must not create another chat");
  await act(async () => {
    emit("message.appended", {
      sequence: 1,
      stepIndex: 0,
      turnId: "turn-1",
      messageDelta: " Two need attention.",
    });
    emit("turn.completed", { sequence: 1, turnId: "turn-1" });
    emit("session.waiting", { inputRequests: [] });
    await sending;
  });
  assert.match(JSON.stringify(renderer.toJSON()), /Two need attention/);
  assert.equal(shell.isWorking, false);
});
