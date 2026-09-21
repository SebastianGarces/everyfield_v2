import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { z } from "zod";

const fileDescriptor = {
  attachmentId: "10000000-0000-4000-8000-000000000099",
  kind: "people_csv",
  name: "people.csv",
  size: 9,
  personId: null,
};

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

test("a usage pause blocks ordinary sends, preserves the draft, and requires an explicit Continue", async (t) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  t.mock.method(console, "error", () => {});
  const posts: Record<string, unknown>[] = [];
  const metadata = {
    id: "usage-paused-session",
    conversationId: "10000000-0000-4000-8000-000000000008",
    title: "Task follow-up",
    createdAt: "2026-09-20T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
  };
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let index = 0;
  const emit = (type: string, data: object) =>
    stream.enqueue(
      new TextEncoder().encode(
        JSON.stringify({
          type,
          data,
          meta: {
            id: `usage-pause-${index++}`,
            at: metadata.createdAt,
            deliveryIds: ["continued-delivery"],
          },
        }) + "\n"
      )
    );
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith("/api/evry/eve/sessions"))
        return Response.json({ session: metadata });
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return Response.json({
          ok: true,
          status: "accepted",
          sessionId: metadata.id,
          deliveryId: "continued-delivery",
        });
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
            emit("session.started", {});
            emit("turn.started", { sequence: 1, turnId: "paused-turn" });
            emit("input.requested", {
              sequence: 1,
              stepIndex: 1,
              turnId: "paused-turn",
              requests: [
                {
                  requestId: "usage-pause",
                  kind: "session-limit",
                  prompt: "SDK usage limit",
                  allowFreeform: false,
                  options: [
                    { id: "continue", label: "Approve" },
                    { id: "stop", label: "Stop" },
                  ],
                  action: {
                    kind: "tool-call",
                    callId: "usage-pause",
                    toolName: "session_limit_continuation",
                    input: { kind: "input", limit: 300000, usedTokens: 300001 },
                  },
                },
              ],
            });
            emit("session.waiting", {
              continuationToken: "fixture",
              wait: "input-response",
            });
          },
        }),
        {
          headers: {
            "content-type": "application/x-ndjson",
            "x-eve-stream-version": "25",
            "x-eve-stream-tail-index": "3",
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
  await act(async () => {
    await shell.loadConversation(metadata.conversationId);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.equal(shell.isWorking, false);
  assert.equal(shell.isComposerBlocked, true);
  await act(() => shell.setDraft("Only high priority"));
  await act(() => shell.sendMessageText("Only high priority"));
  assert.equal(
    posts.length,
    0,
    "Neither replay nor a freeform message approves more usage"
  );
  assert.equal(shell.draft, "Only high priority");
  let continuing!: Promise<void>;
  await act(async () => {
    continuing = shell.respondToQuestion("usage-pause", "", "continue");
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0]?.inputResponses, [
    { requestId: "usage-pause", optionId: "continue" },
  ]);
  await act(async () => {
    emit("input.resolved", {
      sequence: 1,
      stepIndex: 1,
      turnId: "paused-turn",
      resolutions: [
        {
          kind: "session-limit",
          requestId: "usage-pause",
          outcome: "approved",
          response: { requestId: "usage-pause", optionId: "continue" },
        },
      ],
    });
    emit("turn.completed", {
      sequence: 1,
      turnId: "paused-turn",
      stepCount: 1,
    });
    emit("session.waiting", {
      continuationToken: "continued",
      wait: "next-user-message",
    });
    await continuing;
  });
  assert.equal(shell.isComposerBlocked, false);
  assert.equal(shell.draft, "Only high priority");
});

for (const failure of [
  {
    code: "MODEL_CALL_FAILED",
    message: "Provider secret must not be displayed",
    expected: /couldn't finish this response/,
  },
  {
    code: "COMPACTION_FAILED",
    message: "Provider secret must not be displayed",
    expected: /couldn't finish this response/,
  },
  {
    code: "COMPACTION_FAILED",
    message: "EVRY_PROCESSING_LIMIT_REACHED",
    expected: /unusually long investigation/,
  },
])
  for (const reload of [false, true]) {
    test(`a parked ${failure.code}:${failure.message} stays visible ${reload ? "after history replay" : "after send"} and explicit retry starts one same-session turn`, async (t) => {
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
      t.mock.method(console, "error", () => {});
      const posts: { url: string; body: Record<string, unknown> }[] = [];
      const metadata = {
        id: "failed-eve-session",
        conversationId: "10000000-0000-4000-8000-000000000007",
        title: "Launch status",
        createdAt: "2026-09-20T12:00:00.000Z",
        updatedAt: "2026-09-20T12:00:00.000Z",
      };
      const text = "Where are we on launch?";
      let stream!: ReadableStreamDefaultController<Uint8Array>;
      let index = 0;
      const emit = (type: string, data: object) =>
        stream.enqueue(
          new TextEncoder().encode(
            JSON.stringify({
              type,
              data,
              meta: {
                id: `model-failure-${index++}`,
                at: "2026-09-20T12:00:00.000Z",
                deliveryIds: [`delivery-${posts.length}`],
              },
            }) + "\n"
          )
        );
      const fail = () => {
        emit("session.started", {});
        emit("turn.started", { sequence: 1, turnId: "failed-turn" });
        emit("message.received", {
          sequence: 1,
          turnId: "failed-turn",
          message: text,
        });
        emit("step.started", {
          sequence: 1,
          stepIndex: 0,
          turnId: "failed-turn",
          modelId: "fixture",
        });
        emit("step.failed", {
          sequence: 1,
          stepIndex: 0,
          turnId: "failed-turn",
          code: failure.code,
          message: failure.message,
        });
        emit("turn.failed", {
          sequence: 1,
          turnId: "failed-turn",
          code: failure.code,
          message: failure.message,
        });
        emit("session.waiting", {
          continuationToken: "fixture",
          wait: "next-user-message",
        });
      };
      t.mock.method(
        globalThis,
        "fetch",
        async (input: string | URL | Request, init?: RequestInit) => {
          if (String(input).startsWith("/api/evry/eve/sessions"))
            return Response.json({ session: metadata });
          if (init?.method === "POST") {
            posts.push({
              url: String(input),
              body: JSON.parse(String(init.body)),
            });
            return Response.json({
              ok: true,
              status: "accepted",
              sessionId: metadata.id,
              deliveryId: `delivery-${posts.length}`,
            });
          }
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller;
                if (reload) fail();
              },
            }),
            {
              headers: {
                "content-type": "application/x-ndjson",
                "x-eve-stream-version": "25",
                "x-eve-stream-tail-index": reload ? "6" : "-1",
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
        return createElement("p", { role: "alert" }, value.error);
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
      if (reload) {
        await act(async () => {
          await shell.loadConversation(metadata.conversationId);
        });
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      } else {
        let sending!: Promise<void>;
        await act(async () => {
          sending = shell.sendMessageText(text);
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
        await act(async () => {
          fail();
          await sending;
        });
      }
      assert.match(shell.error ?? "", failure.expected);
      assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Provider secret/);
      assert.equal(shell.workState.phase, "failed");
      assert.equal(shell.isWorking, false);
      assert.equal(shell.pendingMessage?.body, text);
      assert.equal(shell.pendingMessage?.delivery, "saved");
      assert.equal(shell.recoveryLabel, "Try again");
      assert.equal(
        posts.length,
        reload ? 0 : 1,
        "failure and replay must not trigger an automatic retry"
      );
      if (reload) {
        await act(() => shell.discardPendingMessage());
        assert.equal(
          shell.draft,
          "",
          "dismissing a saved failure must not copy the original request into the composer"
        );
        assert.equal(shell.pendingMessage, null);
      }
      const before = posts.length;
      await act(() => shell.setDraft("A separate unsent question"));
      await act(async () => {
        shell.resumeWatching();
        shell.resumeWatching();
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      assert.equal(
        posts.length,
        before + 1,
        "double clicking retry must not duplicate delivery"
      );
      assert.equal(posts.at(-1)?.url, `/eve/v1/session/${metadata.id}`);
      assert.equal(
        posts.at(-1)?.body.message,
        "Please try my last request again."
      );
      assert.equal(shell.draft, "A separate unsent question");
      await act(async () => {
        emit("turn.started", { sequence: 2, turnId: "retry-turn" });
        emit("message.received", {
          sequence: 2,
          turnId: "retry-turn",
          message: "Please try my last request again.",
        });
        emit("message.appended", {
          sequence: 2,
          stepIndex: 0,
          turnId: "retry-turn",
          messageDelta: "Five milestones remain.",
        });
        emit("turn.completed", { sequence: 2, turnId: "retry-turn" });
        emit("session.waiting", { inputRequests: [] });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      assert.equal(shell.error, null);
      assert.equal(shell.pendingMessage, null);
      assert.equal(shell.sessionId, metadata.id);
      assert.equal(shell.draft, "A separate unsent question");
      assert.equal(
        shell.messages.filter(
          (message) =>
            message.role === "user" &&
            message.parts.some(
              (part) => part.type === "text" && part.text === text
            )
        ).length,
        1
      );
    });
  }

for (const failure of [
  "message",
  "prewarm",
  "binding",
  "expired-binding",
  "expired-duplicates",
] as const) {
  const file = failure !== "message";
  const expired =
    failure === "expired-binding" || failure === "expired-duplicates";
  test(`a failed ${failure} request keeps ${file ? "the staged file" : "the draft"} and does not duplicate chat creation`, async (t) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    t.mock.method(console, "error", () => {});
    const posts: {
      body: Record<string, unknown>;
      operationId: string | null;
    }[] = [];
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let bindings = 0;
    let stages = 0;
    const boundReferences: string[] = [];
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
        if (String(input) === "/api/evry/eve/attachments") {
          bindings++;
          boundReferences.push(
            z
              .object({ reference: z.string() })
              .parse(JSON.parse(String(init?.body))).reference
          );
          if (failure === "binding" && bindings === 1)
            throw new TypeError("Binding response was lost");
          if (expired && bindings === 1)
            return Response.json({ status: "unavailable" }, { status: 404 });
          return Response.json({ attachment: fileDescriptor });
        }
        if (String(input) === "/api/evry/people/attachments") {
          stages++;
          if (init?.body instanceof FormData)
            return Response.json({ status: "stored" });
          const body = z
            .object({ action: z.string() })
            .parse(JSON.parse(String(init?.body)));
          return Response.json(
            body.action === "prepare"
              ? {
                  status: "prepared",
                  reference: "restaged-reference",
                  chunkBytes: 3 * 1024 * 1024,
                  chunkCount: 1,
                }
              : {
                  status: "staged",
                  reference: "restaged-reference",
                  metadata: { digest: "a".repeat(64) },
                  ...(failure === "expired-duplicates"
                    ? {
                        artifact: {
                          kind: "read",
                          items: [
                            {
                              id: "csv-row-2",
                              label: "Alex Test",
                              facts: [
                                { label: "Status", value: "Duplicate review" },
                                {
                                  label: "Merge target",
                                  value: "Alex Existing",
                                },
                              ],
                            },
                          ],
                        },
                      }
                    : {}),
                }
          );
        }
        if (init?.method === "POST") {
          posts.push({
            body: init.body ? JSON.parse(String(init.body)) : {},
            operationId: new Headers(init.headers).get("x-evry-operation-id"),
          });
          if (
            posts.length === 1 &&
            (failure === "message" || failure === "prewarm")
          ) {
            if (failure === "prewarm")
              return new Response("Service unavailable", { status: 503 });
            throw new TypeError("The accepted response was lost");
          }
          return Response.json({
            ok: true,
            status: "accepted",
            sessionId: metadata.id,
            ...(file && init.body
              ? { deliveryId: "file-review-delivery" }
              : {}),
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
    const fileInput = {
      kind: "people_csv" as const,
      file: new File(["name\nAlex"], "people.csv", { type: "text/csv" }),
      prepared: {
        reference: "signed-staged-reference",
        digest: "digest",
        duplicateRows: [],
      },
      duplicateResolutions: {},
    };
    await act(async () => {
      if (file) {
        const result = await shell.submitPeopleFile(fileInput);
        assert.equal(
          result.status,
          "failed",
          "a swallowed SDK failure must not report file submission success"
        );
      } else await shell.sendMessageText(text);
    });
    if (file) {
      assert.equal(shell.sessionId, failure === "prewarm" ? null : metadata.id);
      assert.equal(
        shell.messages.length,
        0,
        "failed upload setup did not submit a turn"
      );
      const creationKey = posts[0]!.operationId;
      assert.match(creationKey ?? "", /^[a-f0-9-]{36}$/);
      let retry!: ReturnType<typeof shell.submitPeopleFile>;
      await act(async () => {
        retry = shell.submitPeopleFile(fileInput);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      if (failure === "expired-duplicates") {
        const refreshed = await retry;
        assert.equal(refreshed.status, "needs_duplicate_resolution");
        if (refreshed.status !== "needs_duplicate_resolution")
          throw new Error("Expected refreshed duplicate choices");
        assert.deepEqual(
          refreshed.prepared.duplicateRows.map((row) => row.mergeTarget),
          ["Alex Existing"]
        );
        assert.equal(
          posts.length,
          1,
          "new duplicate results require review before submitting a chat turn"
        );
        await act(async () => {
          retry = shell.submitPeopleFile({
            ...fileInput,
            prepared: refreshed.prepared,
            duplicateResolutions: { "2": "skip" },
          });
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
      }
      assert.equal(
        posts.length,
        failure === "prewarm" ? 3 : 2,
        "binding retry reuses the created chat; prewarm retry retains its creation identity"
      );
      if (failure === "prewarm")
        assert.equal(
          posts[1]!.operationId,
          creationKey,
          "lost prewarm retains the same server creation identity"
        );
      assert.equal(posts[0]!.body.message, undefined);
      if (failure === "prewarm")
        assert.equal(posts[1]!.body.message, undefined);
      const context = z
        .object({ attachment: z.object({ attachmentId: z.string() }) })
        .parse(posts.at(-1)!.body.clientContext);
      assert.equal(
        context.attachment.attachmentId,
        fileDescriptor.attachmentId
      );
      assert.equal(
        JSON.stringify(posts).includes("signed-staged-reference"),
        false
      );
      assert.equal(
        stages,
        expired ? 3 : 0,
        "only a definitive unavailable binding restages the selected File"
      );
      if (expired)
        assert.deepEqual(boundReferences, [
          "signed-staged-reference",
          "restaged-reference",
        ]);
      if (failure === "binding")
        assert.deepEqual(boundReferences, [
          "signed-staged-reference",
          "signed-staged-reference",
        ]);
      let index = 0;
      const emit = (type: string, data: object) =>
        stream.enqueue(
          new TextEncoder().encode(
            JSON.stringify({
              type,
              data,
              meta: {
                id: `file-retry-${index++}`,
                deliveryIds: ["file-review-delivery"],
              },
            }) + "\n"
          )
        );
      await act(async () => {
        emit("session.started", {});
        emit("turn.started", { sequence: 1, turnId: "file-review-turn" });
        emit("message.received", {
          sequence: 1,
          turnId: "file-review-turn",
          message: text,
        });
        emit("message.appended", {
          sequence: 1,
          stepIndex: 0,
          turnId: "file-review-turn",
          messageDelta: "Here is the review.",
        });
        emit("turn.completed", { sequence: 1, turnId: "file-review-turn" });
        emit("session.waiting", { inputRequests: [] });
        const result = await retry;
        assert.equal(
          result.status,
          "submitted",
          JSON.stringify({
            result,
            error: shell.error,
            pending: shell.pendingMessage,
          })
        );
      });
      assert.equal(shell.sessionId, metadata.id);
      assert.equal(
        shell.messages.filter((message) => message.role === "user").length,
        1
      );
      return;
    }
    assert.equal(shell.sessionId, null);
    assert.equal(shell.draft, text);
    assert.equal(shell.pendingMessage?.body, text);
    assert.equal(shell.pendingMessage?.delivery, "uncertain");
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
    const bodies: Record<string, unknown>[] = [];
    let streams = 0;
    let eventIndex = 0;
    const text = accepted
      ? "Which tasks are due today?"
      : "Review importing people from people.csv.";
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
        if (String(input) === "/api/evry/eve/attachments")
          return Response.json({ attachment: fileDescriptor });
        if (init?.method === "POST") {
          posts++;
          bodies.push(JSON.parse(String(init.body)));
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
      if (accepted) await shell.sendMessageText(text);
      else
        await shell.submitPeopleFile({
          kind: "people_csv",
          file: new File(["name\nAlex"], "people.csv", { type: "text/csv" }),
          prepared: {
            reference: "known-session-staged-reference",
            digest: "digest",
            duplicateRows: [],
          },
          duplicateResolutions: {},
        });
    });
    assert.equal(posts, 1);
    assert.equal(shell.draft, text);
    assert(shell.pendingMessage);
    assert.equal(shell.pendingMessage.delivery, "uncertain");
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
      await act(async () => {
        await shell.sendMessageText(text);
      });
      assert.equal(
        posts,
        2,
        "only an explicit Send may submit the unconfirmed draft again"
      );
      assert.deepEqual(bodies[1], bodies[0]);
      assert.equal(
        z
          .object({ attachment: z.object({ attachmentId: z.string() }) })
          .parse(bodies[1]!.clientContext).attachment.attachmentId,
        fileDescriptor.attachmentId
      );
      assert.equal(
        JSON.stringify(bodies).includes("known-session-staged-reference"),
        false
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
