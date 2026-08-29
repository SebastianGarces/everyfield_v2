import assert from "node:assert/strict";
import { test } from "node:test";

import { evryConversationStream } from "@/app/api/evry/conversations/stream";
import type { PublicEvryConversation } from "@/lib/evry/conversations/public-contract";

import {
  evryConversationStreamEventSchema,
  readEvryConversationStream,
} from "./conversation-wire";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const conversation: PublicEvryConversation = {
  id: CONVERSATION_ID,
  title: "A durable conversation",
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
      body: "Keep literal bytes",
      pageContext: null,
      deliveryStatus: "complete",
      createdAt: "2026-08-28T12:00:00.000Z",
      artifacts: [],
    },
  ],
};

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const read = await reader.read();
  assert.equal(read.done, false);
  return evryConversationStreamEventSchema.parse(
    JSON.parse(new TextDecoder().decode(read.value).trim())
  );
}

test("the server stream exposes actual work and durable output before terminal completion", async () => {
  const persistence = Promise.withResolvers<void>();
  const response = evryConversationStream({
    requestId: REQUEST_ID,
    run: async (report) => {
      report("resolving_references");
      await persistence.promise;
      report("compiling_response");
      return { conversation };
    },
    failureCode: () => "unavailable",
  });
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/x-ndjson/
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const reader = response.body!.getReader();

  assert.deepEqual(await readEvent(reader), {
    type: "work",
    requestId: REQUEST_ID,
    sequence: 0,
    phase: "reading",
    code: "request_accepted",
  });
  assert.equal((await readEvent(reader)).type, "work");
  persistence.resolve();
  assert.equal((await readEvent(reader)).type, "work");
  const usefulOutput = await readEvent(reader);
  assert.equal(usefulOutput.type, "conversation");
  assert.equal(
    usefulOutput.type === "conversation" ? usefulOutput.conversation.id : null,
    CONVERSATION_ID
  );
  assert.equal((await readEvent(reader)).type, "complete");
  assert.equal((await reader.read()).done, true);
});

test("the client accepts split chunks only for the expected request and conversation", async () => {
  const events = [
    {
      type: "work",
      requestId: REQUEST_ID,
      sequence: 0,
      phase: "reading",
      code: "request_accepted",
    },
    {
      type: "conversation",
      requestId: REQUEST_ID,
      sequence: 1,
      conversation,
    },
    { type: "complete", requestId: REQUEST_ID, sequence: 2 },
  ].map((event) => JSON.stringify(event));
  const bytes = new TextEncoder().encode(`${events.join("\n")}\n`);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 17));
      controller.enqueue(bytes.slice(17));
      controller.close();
    },
  });
  const observed: string[] = [];
  const result = await readEvryConversationStream(
    new Response(body, {
      headers: { "content-type": "application/x-ndjson" },
    }),
    {
      requestId: REQUEST_ID,
      expectedConversationId: CONVERSATION_ID,
      onEvent: (event) => observed.push(event.type),
    }
  );
  assert.equal(result.conversation.id, CONVERSATION_ID);
  assert.deepEqual(observed, ["work", "conversation", "complete"]);
});

test("foreign, duplicate, and incomplete stream events fail closed", async () => {
  const responseFor = (lines: readonly string[]) =>
    new Response(`${lines.join("\n")}\n`, {
      headers: { "content-type": "application/x-ndjson" },
    });
  const read = (response: Response) =>
    readEvryConversationStream(response, {
      requestId: REQUEST_ID,
      expectedConversationId: null,
      onEvent: () => {},
    });

  await assert.rejects(
    read(
      responseFor([
        JSON.stringify({
          type: "work",
          requestId: "10000000-0000-4000-8000-000000000002",
          sequence: 0,
          phase: "reading",
          code: "request_accepted",
        }),
      ])
    ),
    /out of sequence/
  );
  await assert.rejects(
    read(
      responseFor([
        JSON.stringify({
          type: "work",
          requestId: REQUEST_ID,
          sequence: 0,
          phase: "reading",
          code: "compiling_response",
        }),
      ])
    )
  );
  await assert.rejects(
    read(
      responseFor([
        JSON.stringify({
          type: "work",
          requestId: REQUEST_ID,
          sequence: 0,
          phase: "reading",
          code: "request_accepted",
        }),
        JSON.stringify({
          type: "work",
          requestId: REQUEST_ID,
          sequence: 0,
          phase: "planning",
          code: "compiling_response",
        }),
      ])
    ),
    /out of sequence/
  );
  await assert.rejects(
    read(
      responseFor([
        JSON.stringify({
          type: "work",
          requestId: REQUEST_ID,
          sequence: 0,
          phase: "planning",
          code: "compiling_response",
        }),
      ])
    ),
    /omitted its acceptance/
  );
  await assert.rejects(
    read(
      responseFor([
        JSON.stringify({
          type: "conversation",
          requestId: REQUEST_ID,
          sequence: 0,
          conversation,
        }),
      ])
    ),
    /omitted its acceptance/
  );
  await assert.rejects(
    read(
      responseFor([
        JSON.stringify({
          type: "work",
          requestId: REQUEST_ID,
          sequence: 0,
          phase: "reading",
          code: "request_accepted",
        }),
        JSON.stringify({
          type: "conversation",
          requestId: REQUEST_ID,
          sequence: 5,
          conversation,
        }),
        JSON.stringify({
          type: "complete",
          requestId: REQUEST_ID,
          sequence: 9,
        }),
      ])
    ),
    /out of sequence/
  );
  await assert.rejects(
    read(
      responseFor([
        JSON.stringify({
          type: "work",
          requestId: REQUEST_ID,
          sequence: 0,
          phase: "reading",
          code: "request_accepted",
        }),
        JSON.stringify({
          type: "complete",
          requestId: REQUEST_ID,
          sequence: 1,
        }),
      ])
    ),
    /without durable output/
  );
  await assert.rejects(
    read(
      responseFor([
        JSON.stringify({
          type: "work",
          requestId: REQUEST_ID,
          sequence: 0,
          phase: "reading",
          code: "request_accepted",
        }),
        JSON.stringify({
          type: "conversation",
          requestId: REQUEST_ID,
          sequence: 1,
          conversation,
        }),
      ])
    ),
    /before completion/
  );
});
