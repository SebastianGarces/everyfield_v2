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

for (const file of [false, true]) {
  test(`a lost first POST keeps ${file ? "the staged file" : "the draft"} and retries the same creation operation`, async (t) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    t.mock.method(console, "error", () => {});
    const posts: {
      body: Record<string, unknown>;
      operationId: string | null;
    }[] = [];
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const metadata = {
      id: "recovered-eve-session",
      conversationId: "10000000-0000-4000-8000-000000000002",
      title: "Recovered request",
      createdAt: "2026-09-20T12:00:00.000Z",
      updatedAt: "2026-09-20T12:00:00.000Z",
    };
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).startsWith("/api/evry/eve/sessions"))
          return Response.json({ session: metadata });
        if (init?.method === "POST") {
          posts.push({
            body: JSON.parse(String(init.body)),
            operationId: new Headers(init.headers).get("x-evry-operation-id"),
          });
          if (posts.length === 1) {
            if (file)
              return new Response("Service unavailable", { status: 503 });
            throw new TypeError("The accepted response was lost");
          }
          return Response.json({
            ok: true,
            status: "accepted",
            sessionId: metadata.id,
          });
        }
        assert.match(
          String(input),
          /\/eve\/v1\/session\/recovered-eve-session\/stream/
        );
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
            },
          }),
          {
            headers: {
              "x-eve-stream-version": "25",
              "x-eve-stream-tail-index": "-1",
              "content-type": "application/x-ndjson",
            },
          }
        );
      }
    );
    const { EvryShell, useEvryShell } = await import("../evry-shell");
    let shell!: ReturnType<typeof useEvryShell>;
    function Probe() {
      const value = useEvryShell();
      useEffect(() => {
        shell = value;
      }, [value]);
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(() => {
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
    const text = file
      ? "Review importing people from people.csv."
      : "Where are we on launch?";
    await act(async () => {
      if (file) {
        const result = await shell.submitPeopleFile({
          kind: "people_csv",
          file: new File(["name\nAlex"], "people.csv", { type: "text/csv" }),
          prepared: {
            reference: "signed-staged-reference",
            digest: "digest",
            duplicateRows: [],
          },
          duplicateResolutions: {},
        });
        assert.equal(
          result.status,
          "failed",
          "a swallowed SDK failure must not report file submission success"
        );
      } else await shell.sendMessageText(text);
    });
    assert.equal(shell.sessionId, null);
    assert.equal(shell.draft, text);
    assert.equal(shell.pendingMessage?.body, text);
    assert.match(shell.error ?? "", /message is kept/);
    assert.match(posts[0]!.operationId ?? "", /^[a-f0-9-]{36}$/);
    // A draft written after the failure must survive successful recovery.
    await act(() => shell.setDraft("My next question"));
    await act(async () => {
      shell.resumeWatching();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(posts.length, 2);
    assert.deepEqual(
      posts[1],
      posts[0],
      "retry must retain the exact message, attachment, context, and creation identity"
    );
    if (file)
      assert.equal(
        JSON.parse(String(posts[1]!.body.clientContext)).attachment.reference,
        "signed-staged-reference"
      );
    let index = 0;
    const emit = (type: string, data: object) =>
      stream.enqueue(
        new TextEncoder().encode(
          JSON.stringify({ type, data, meta: { id: `retry-${index++}` } }) +
            "\n"
        )
      );
    await act(async () => {
      emit("session.started", {});
      emit("turn.started", { sequence: 1, turnId: "recovered-turn" });
      emit("message.received", {
        sequence: 1,
        turnId: "recovered-turn",
        message: text,
      });
      emit("message.appended", {
        sequence: 1,
        stepIndex: 0,
        turnId: "recovered-turn",
        messageDelta: "Here is the review.",
      });
      emit("turn.completed", { sequence: 1, turnId: "recovered-turn" });
      emit("session.waiting", { inputRequests: [] });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(shell.sessionId, metadata.id);
    assert.equal(shell.pendingMessage, null);
    assert.equal(shell.error, null);
    assert.equal(shell.draft, "My next question");
    assert.equal(
      shell.messages.filter((message) => message.role === "user").length,
      1
    );
  });
}

for (const accepted of [true, false]) {
  test(`an existing-session send ${accepted ? "recovers accepted output" : "keeps an unconfirmed draft"} without a duplicate POST`, async (t) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    t.mock.method(console, "error", () => {});
    let posts = 0;
    let streams = 0;
    let eventIndex = 0;
    const text = "Which tasks are due today?";
    const metadata = {
      id: "existing-session",
      conversationId: "10000000-0000-4000-8000-000000000003",
      title: "Existing chat",
      createdAt: "2026-09-20T12:00:00.000Z",
      updatedAt: "2026-09-20T12:00:00.000Z",
    };
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).startsWith("/api/evry/eve/sessions"))
          return Response.json({ session: metadata });
        if (init?.method === "POST") {
          posts++;
          throw new TypeError("Accepted response lost");
        }
        streams++;
        const events =
          streams === 1
            ? [
                { type: "session.started", data: {} },
                { type: "session.waiting", data: { inputRequests: [] } },
              ]
            : !accepted
              ? [{ type: "session.waiting", data: { inputRequests: [] } }]
              : [
                  {
                    type: "turn.started",
                    data: { sequence: 1, turnId: "accepted-turn" },
                  },
                  {
                    type: "message.received",
                    data: {
                      sequence: 1,
                      turnId: "accepted-turn",
                      message: text,
                    },
                  },
                  {
                    type: "message.appended",
                    data: {
                      sequence: 1,
                      stepIndex: 0,
                      turnId: "accepted-turn",
                      messageDelta: "One task is due today.",
                    },
                  },
                  {
                    type: "turn.completed",
                    data: { sequence: 1, turnId: "accepted-turn" },
                  },
                  { type: "session.waiting", data: { inputRequests: [] } },
                ];
        const body =
          events
            .map((event) =>
              JSON.stringify({
                ...event,
                meta: { id: `known-${eventIndex++}` },
              })
            )
            .join("\n") + "\n";
        return new Response(body, {
          headers: {
            "x-eve-stream-version": "25",
            "x-eve-stream-tail-index": String(eventIndex - 1),
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
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(() => {
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
    await act(async () => {
      await shell.loadConversation(metadata.conversationId);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      await shell.sendMessageText(text);
    });
    assert.equal(posts, 1);
    assert.equal(shell.draft, text);
    assert(shell.pendingMessage);
    await act(async () => {
      shell.resumeWatching();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(posts, 1, "reconnect must only read the durable stream");
    assert.equal(shell.pendingMessage, null);
    if (!accepted) {
      assert.match(shell.error ?? "", /isn't in the saved conversation yet/);
      assert.equal(shell.draft, text);
      assert.equal(
        shell.messages.filter((message) => message.role === "user").length,
        0
      );
      return;
    }
    assert.equal(shell.error, null);
    assert.equal(shell.draft, "");
    assert.equal(
      shell.messages.filter((message) => message.role === "user").length,
      1
    );
    assert.match(JSON.stringify(shell.messages), /One task is due today/);
  });
}

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
