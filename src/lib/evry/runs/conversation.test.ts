import assert from "node:assert/strict";
import { test } from "node:test";

import type { PublicEvryConversation } from "@/lib/evry/conversations/public-contract";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryConversationStreamStage } from "@/lib/evry/streaming/conversation-wire";

import {
  EVRY_ACTIVE_RUN_TTL_MS,
  fingerprintEvryActiveRunRequest,
  parseEvryActiveRunRecord,
  type EvryActiveRunRecord,
} from "./contract";
import {
  prepareEvryConversationActiveRun,
  runPreparedEvryConversationActiveRun,
  type EvryConversationRunInput,
} from "./conversation";

const START = new Date("2026-08-29T01:00:00.000Z");
const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const actor = {
  userId: "30000000-0000-4000-8000-000000000001",
  plantId: "40000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const conversation: PublicEvryConversation = {
  id: CONVERSATION_ID,
  title: "Durable output",
  createdAt: START.toISOString(),
  lastActivityAt: START.toISOString(),
  activePlan: null,
  stateVersion: 0,
  state: {},
  messages: [],
};

function row(
  input: {
    status?: "active" | "completed" | "failed";
    stage?: "accepted" | EvryConversationStreamStage;
    version?: number;
    conversationId?: string | null;
  } = {}
): EvryActiveRunRecord {
  const status = input.status ?? "active";
  const changedAt = new Date(START.valueOf() + (input.version ?? 0));
  return parseEvryActiveRunRecord({
    id: "50000000-0000-4000-8000-000000000001",
    churchId: actor.plantId,
    actorUserId: actor.userId,
    requestKey: REQUEST_ID,
    requestFingerprint: fingerprintEvryActiveRunRequest({ message: "hello" }),
    kind: "conversation",
    operation: "create",
    status,
    stage: input.stage ?? "accepted",
    version: input.version ?? 0,
    conversationId: input.conversationId ?? null,
    planId: null,
    planFingerprint: null,
    startedAt: START,
    changedAt,
    expiresAt: new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
    completedAt: status === "active" ? null : changedAt,
  });
}

function runInput(
  perform: EvryConversationRunInput["perform"]
): EvryConversationRunInput {
  return {
    actor,
    requestKey: REQUEST_ID,
    identity: {
      kind: "conversation",
      operation: "create",
      conversationId: null,
      planId: null,
      planFingerprint: null,
    },
    fingerprintInput: { message: "hello" },
    startedAt: START,
    perform,
  };
}

test("a claim precedes work, stages precede presentation, and completion precedes output", async () => {
  const events: string[] = [];
  let current = row();
  let clock = 0;
  const boundaries = {
    runs: {
      find: async () => current,
      claim: async () => {
        events.push("claim");
        return { ownership: "claimed" as const, run: current };
      },
      advance: async ({ stage }: { stage: EvryConversationStreamStage }) => {
        events.push(`persist:${stage}`);
        current = row({ stage, version: current.version + 1 });
        return current;
      },
      complete: async ({ conversationId }: { conversationId: string }) => {
        events.push("persist:complete");
        current = row({
          status: "completed",
          stage: "compiling_response",
          version: current.version + 1,
          conversationId,
        });
        return current;
      },
      fail: async () => current,
    },
    recover: async () => ({
      status: "durable" as const,
      requestId: REQUEST_ID,
      kind: "conversation" as const,
      sequence: current.version,
      conversation,
    }),
    now: () => new Date(START.valueOf() + ++clock),
  };
  const prepared = await prepareEvryConversationActiveRun(
    runInput(async (report) => {
      events.push("work");
      await report("resolving_references");
      await report("revalidating_plan");
      await report("compiling_response");
      return { conversation };
    }),
    boundaries
  );
  assert.deepEqual(events, ["claim"]);

  const result = await runPreparedEvryConversationActiveRun(
    prepared,
    (stage) => events.push(`present:${stage}`),
    boundaries
  );
  events.push("present:durable");
  assert.ok(result && "conversation" in result);
  assert.equal(result.conversation.id, CONVERSATION_ID);
  assert.deepEqual(events, [
    "claim",
    "work",
    "persist:resolving_references",
    "present:resolving_references",
    "persist:revalidating_plan",
    "present:revalidating_plan",
    "persist:compiling_response",
    "present:compiling_response",
    "persist:complete",
    "present:durable",
  ]);
});

test("response loss after durable completion adopts the same create without rerunning", async () => {
  let performCount = 0;
  const completed = row({
    status: "completed",
    stage: "compiling_response",
    version: 4,
    conversationId: CONVERSATION_ID,
  });
  const boundaries = {
    runs: {
      find: async () => completed,
      claim: async () => ({ ownership: "adopted" as const, run: completed }),
      advance: async () => {
        throw new Error("an adopted run cannot advance");
      },
      complete: async () => {
        throw new Error("an adopted run cannot complete again");
      },
      fail: async () => {
        throw new Error("an adopted run cannot fail again");
      },
    },
    recover: async () => ({
      status: "durable" as const,
      requestId: REQUEST_ID,
      kind: "conversation" as const,
      sequence: completed.version + 1,
      conversation,
    }),
    now: () => new Date(START.valueOf() + 1_000),
  };
  const prepared = await prepareEvryConversationActiveRun(
    runInput(async () => {
      performCount += 1;
      return { conversation };
    }),
    boundaries
  );
  const replay = await runPreparedEvryConversationActiveRun(
    prepared,
    () => {},
    boundaries
  );
  assert.ok(replay && "conversation" in replay);
  assert.equal(replay.conversation.id, CONVERSATION_ID);
  assert.equal(performCount, 0);
});

test("a same-key retry adopts the active owner instead of becoming a terminal failure", async () => {
  let performCount = 0;
  const active = row({ status: "active", version: 2 });
  const boundaries = {
    runs: {
      find: async () => active,
      claim: async () => ({ ownership: "adopted" as const, run: active }),
      advance: async () => {
        throw new Error("an adopted run cannot advance");
      },
      complete: async () => {
        throw new Error("an adopted run cannot complete");
      },
      fail: async () => {
        throw new Error("an adopted run cannot fail");
      },
    },
    recover: async () => ({
      status: "active" as const,
      requestId: REQUEST_ID,
      kind: "conversation" as const,
      sequence: active.version,
      stage: active.stage,
      conversationId: active.conversationId,
      expiresAt: active.expiresAt.toISOString(),
    }),
    now: () => new Date(START.valueOf() + 1_000),
  };
  const prepared = await prepareEvryConversationActiveRun(
    runInput(async () => {
      performCount += 1;
      return { conversation };
    }),
    boundaries
  );
  const replay = await runPreparedEvryConversationActiveRun(
    prepared,
    () => {},
    boundaries
  );
  assert.deepEqual(replay, { status: "active" });
  assert.equal(performCount, 0);
});

test("crashes before output settle the one claim with its latest durable identity", async () => {
  for (const crashPoint of ["perform", "present", "complete"] as const) {
    const events: string[] = [];
    let current = row();
    const boundaries = {
      runs: {
        find: async () => current,
        claim: async () => ({ ownership: "claimed" as const, run: current }),
        advance: async ({ stage }: { stage: EvryConversationStreamStage }) => {
          current = row({ stage, version: 1 });
          events.push("persist:stage");
          return current;
        },
        complete: async () => {
          events.push("persist:complete-attempt");
          if (crashPoint === "complete") throw new Error("crash:complete");
          return current;
        },
        fail: async ({
          conversationId,
        }: {
          conversationId?: string | null;
        }) => {
          events.push(`fail:${conversationId ?? "none"}`);
          current = row({
            status: "failed",
            stage: current.stage === "executing" ? "accepted" : current.stage,
            version: current.version + 1,
            conversationId: conversationId ?? null,
          });
          return current;
        },
      },
      recover: async () => ({
        status: "unavailable" as const,
        requestId: REQUEST_ID,
      }),
      now: () => new Date(START.valueOf() + 10),
    };
    const prepared = await prepareEvryConversationActiveRun(
      runInput(async (report) => {
        if (crashPoint === "perform") throw new Error("crash:perform");
        await report("compiling_response");
        return { conversation };
      }),
      boundaries
    );
    await assert.rejects(
      runPreparedEvryConversationActiveRun(
        prepared,
        () => {
          if (crashPoint === "present") throw new Error("crash:present");
        },
        boundaries
      ),
      new RegExp(`crash:${crashPoint}`)
    );
    assert.equal(current.status, "failed");
    assert.equal(
      current.conversationId,
      crashPoint === "complete" ? CONVERSATION_ID : null
    );
    assert.equal(events.at(-1), `fail:${current.conversationId ?? "none"}`);
  }
});
