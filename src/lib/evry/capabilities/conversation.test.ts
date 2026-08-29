import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";

import {
  composeEvryCapabilityConversationContinuations,
  type EvryCapabilityConversationContinuation,
} from "./conversation";

test("conversation composition selects only the first closed pack", async () => {
  const calls: string[] = [];
  const selected = { id: "selected" } as unknown as EvryStoredConversation;
  const continuation = composeEvryCapabilityConversationContinuations([
    (async () => {
      calls.push("first");
      return null;
    }) as EvryCapabilityConversationContinuation,
    (async () => {
      calls.push("second");
      return selected;
    }) as EvryCapabilityConversationContinuation,
    (async () => {
      calls.push("third");
      return selected;
    }) as EvryCapabilityConversationContinuation,
  ]);

  assert.equal(await continuation({} as never), selected);
  assert.deepEqual(calls, ["first", "second"]);
});

test("empty conversation composition has no production continuation", async () => {
  const continuation = composeEvryCapabilityConversationContinuations([]);
  assert.equal(await continuation({} as never), null);
});
