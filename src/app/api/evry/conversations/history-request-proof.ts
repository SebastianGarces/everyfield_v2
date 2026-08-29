import assert from "node:assert/strict";
import { mock } from "node:test";

import { UnauthorizedError } from "@/lib/auth/unauthorized";
import type { EvryConversationHistoryItem } from "@/lib/evry/conversations/history";

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

const PLANT_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_PLANT_ID = "10000000-0000-4000-8000-000000000002";
const ACTOR_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_ACTOR_ID = "20000000-0000-4000-8000-000000000002";
const FOREIGN_ACTOR_ID = "20000000-0000-4000-8000-000000000003";

const sessions: Array<SessionUser | null> = [];
const events: string[] = [];

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      events.push("auth");
      const user = sessions.shift();
      if (!user) throw new UnauthorizedError();
      return { user };
    },
  },
});

const candidates = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    actorUserId: ACTOR_ID,
    plantId: PLANT_ID,
    title: "Meeting invitation",
    transcript: "Visible own transcript term",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    actorUserId: OTHER_ACTOR_ID,
    plantId: PLANT_ID,
    title: "Other account secret",
    transcript: "same-plant-private-term",
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    actorUserId: FOREIGN_ACTOR_ID,
    plantId: OTHER_PLANT_ID,
    title: "Other plant secret",
    transcript: "foreign-plant-private-term",
  },
] as const;

function historyItem(
  candidate: (typeof candidates)[number]
): EvryConversationHistoryItem {
  return {
    id: candidate.id,
    title: candidate.title,
    lastActivityAt: "2026-08-28T12:00:00.000Z",
    lastActivityLabel: "Just now",
    lastActivityTitle: "Aug 28, 2026 at 8:00 AM",
    actionableState: "ready",
  };
}

async function responseBody(response: Response): Promise<unknown> {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response.json();
}

async function main(): Promise<void> {
  const route = await import("./route");
  const get = route.createEvryConversationHistoryGet({
    now: () => new Date("2026-08-28T12:00:00.000Z"),
    list: async ({ actor, search }) => {
      events.push("list");
      const term = search?.toLocaleLowerCase("en-US") ?? null;
      return candidates
        .filter(
          (candidate) =>
            candidate.actorUserId === actor.userId &&
            candidate.plantId === actor.plantId
        )
        .filter(
          (candidate) =>
            term === null ||
            candidate.title.toLocaleLowerCase("en-US").includes(term) ||
            candidate.transcript.toLocaleLowerCase("en-US").includes(term)
        )
        .map(historyItem);
    },
  });
  const actor: SessionUser = {
    id: ACTOR_ID,
    churchId: PLANT_ID,
    sendingChurchId: null,
    sendingNetworkId: null,
    seat: "owner",
  };

  sessions.push(null);
  events.length = 0;
  const anonymous = await get(
    new Request(
      "http://localhost/api/evry/conversations?q=foreign-plant-private-term"
    )
  );
  assert.equal(anonymous.status, 401);
  assert.deepEqual(events, ["auth"]);

  sessions.push(actor);
  events.length = 0;
  const own = await get(
    new Request(
      "http://localhost/api/evry/conversations?q=visible%20own%20transcript"
    )
  );
  assert.equal(own.status, 200);
  assert.deepEqual(events, ["auth", "list"]);
  assert.deepEqual(await responseBody(own), {
    status: "available",
    conversations: [historyItem(candidates[0])],
  });

  for (const privateTerm of [
    "same-plant-private-term",
    "foreign-plant-private-term",
  ]) {
    sessions.push(actor);
    events.length = 0;
    const privateSearch = await get(
      new Request(`http://localhost/api/evry/conversations?q=${privateTerm}`)
    );
    assert.equal(privateSearch.status, 200);
    assert.deepEqual(events, ["auth", "list"]);
    assert.deepEqual(await responseBody(privateSearch), {
      status: "available",
      conversations: [],
    });
  }

  sessions.push(actor);
  events.length = 0;
  const invalid = await get(
    new Request(`http://localhost/api/evry/conversations?q=${"x".repeat(121)}`)
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(events, ["auth"]);

  process.stdout.write("Evry conversation history request proof passed\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
