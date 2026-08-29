import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";

import {
  composeEvryCapabilityConversationContinuations,
  EvryCapabilityConversationAmbiguityError,
  type EvryCapabilityConversationContinuation,
} from "./conversation";

function registration(input: {
  identity: string;
  match: boolean;
  calls: string[];
  result?: EvryStoredConversation;
}): EvryCapabilityConversationContinuation {
  return {
    identity: input.identity,
    matches() {
      input.calls.push(`match:${input.identity}`);
      return input.match;
    },
    async continue() {
      input.calls.push(`continue:${input.identity}`);
      return input.result ?? null;
    },
  };
}

test("conversation composition evaluates every pure matcher then invokes one pack", async () => {
  const calls: string[] = [];
  const selected = {
    id: "selected",
    messages: [],
  } as unknown as EvryStoredConversation;
  const continuation = composeEvryCapabilityConversationContinuations([
    registration({ identity: "first", match: false, calls }),
    registration({ identity: "second", match: true, calls, result: selected }),
    registration({ identity: "third", match: false, calls }),
  ]);

  assert.equal(
    await continuation({
      conversation: { id: "conversation", messages: [] },
      userRequestKey: "request",
    } as never),
    selected
  );
  assert.deepEqual(calls, [
    "match:first",
    "match:second",
    "match:third",
    "continue:second",
  ]);
});

test("ambiguous packs fail before any continuation can mutate", async () => {
  const calls: string[] = [];
  const continuation = composeEvryCapabilityConversationContinuations([
    registration({ identity: "first", match: true, calls }),
    registration({ identity: "second", match: true, calls }),
  ]);

  await assert.rejects(
    continuation({
      conversation: { id: "conversation", messages: [] },
      userRequestKey: "request",
    } as never),
    EvryCapabilityConversationAmbiguityError
  );
  assert.deepEqual(calls, ["match:first", "match:second"]);
});

test("a durable request result is recovered before match or continuation work", async () => {
  const calls: string[] = [];
  let source = "first source value";
  const continuation = composeEvryCapabilityConversationContinuations([
    {
      identity: "people",
      matches() {
        calls.push(`match:${source}`);
        return true;
      },
      async continue(input) {
        calls.push(`continue:${source}`);
        return {
          ...input.conversation,
          messages: [
            ...input.conversation.messages,
            {
              id: input.resultIdentity.messageId,
              requestKey: input.resultIdentity.requestKey,
              author: "assistant",
              body: source,
            },
          ],
        } as EvryStoredConversation;
      },
    },
  ]);
  const first = await continuation({
    conversation: { id: "conversation", messages: [] },
    userRequestKey: "request",
  } as never);
  assert.ok(first);

  source = "changed source value";
  const replay = await continuation({
    conversation: first,
    userRequestKey: "request",
  } as never);
  assert.equal(replay, first);
  assert.equal(first.messages.at(-1)?.body, "first source value");
  assert.deepEqual(calls, [
    "match:first source value",
    "continue:first source value",
  ]);
});

test("empty conversation composition has no production continuation", async () => {
  const continuation = composeEvryCapabilityConversationContinuations([]);
  assert.equal(
    await continuation({
      conversation: { id: "conversation", messages: [] },
      userRequestKey: "request",
    } as never),
    null
  );
});
