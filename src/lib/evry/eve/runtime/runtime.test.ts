import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authenticatedSessionId,
  withAuthenticatedSessionId,
} from "@/lib/auth/session-scope";
import {
  authenticatedSessionOf,
  createEveAuthPolicy,
  principalForSession,
  readSessionCookie,
} from "./auth-policy";
import { applyTaskPatch, emptyTaskState, taskPatchSchema } from "./task-state";
import { collectResult, findResult } from "./results";

const alice = {
  appSessionId: "a".repeat(64),
  userId: "alice",
  plantId: "church-a",
};
const bob = {
  appSessionId: "b".repeat(64),
  userId: "bob",
  plantId: "church-b",
};
function request(
  path: string,
  method = "GET",
  cookie = "session=valid",
  origin = "https://preview.example"
) {
  return new Request(`https://preview.example/eve/v1/${path}`, {
    method,
    headers: { cookie, origin },
  });
}

test("every Eve session operation requires fresh authentication and matching ownership", async () => {
  let active = true;
  let checks = 0;
  const auth = createEveAuthPolicy({
    authenticate: async (token) => {
      checks++;
      return active && token === "valid" ? alice : null;
    },
    store: {
      owns: async (id, owner) =>
        id === "owned" &&
        owner.userId === alice.userId &&
        owner.plantId === alice.plantId,
    },
  });
  for (const path of [
    "session/owned",
    "session/owned/stream",
    "session/owned/message",
    "session/owned/stop",
  ])
    assert.equal((await auth(request(path)))?.principalId, "alice");
  await assert.rejects(auth(request("session/foreign")));
  active = false;
  assert.equal(await auth(request("session/owned/stream")), null);
  assert.equal(checks, 6);
});

test("same-user different church and different-user same church cannot access a saved session", async () => {
  for (const viewer of [
    { ...alice, plantId: bob.plantId },
    { ...alice, userId: bob.userId },
  ]) {
    const auth = createEveAuthPolicy({
      authenticate: async () => viewer,
      store: {
        owns: async (_id, owner) =>
          owner.userId === alice.userId && owner.plantId === alice.plantId,
      },
    });
    await assert.rejects(auth(request("session/owned")));
  }
});

test("mutations reject cross-origin, absent origin and cross-site requests", async () => {
  const auth = createEveAuthPolicy({
    authenticate: async () => alice,
    store: { owns: async () => true },
  });
  await assert.rejects(
    auth(
      request("session", "POST", "session=valid", "https://attacker.example")
    )
  );
  await assert.rejects(
    auth(
      new Request("https://preview.example/eve/v1/session", {
        method: "POST",
        headers: { cookie: "session=valid" },
      })
    )
  );
  await assert.rejects(
    auth(
      new Request("https://preview.example/eve/v1/session", {
        method: "POST",
        headers: {
          cookie: "session=valid",
          origin: "https://preview.example",
          "sec-fetch-site": "cross-site",
        },
      })
    )
  );
  assert.equal((await auth(request("session", "POST")))?.principalId, "alice");
});

test("missing, duplicate and malformed session cookies fail closed", () => {
  for (const cookie of [
    "",
    "session=",
    "session=%GG",
    "session=a; session=b",
    "other=value",
  ])
    assert.equal(readSessionCookie(request("session", "POST", cookie)), null);
  assert.equal(
    readSessionCookie(request("session", "POST", "other=x; session=a%2Fb")),
    "a/b"
  );
});

test("session authority is authenticated metadata, not model-supplied fields", () => {
  assert.deepEqual(authenticatedSessionOf(principalForSession(alice)), alice);
  assert.throws(() => authenticatedSessionOf(null));
  assert.throws(() =>
    authenticatedSessionOf({
      ...principalForSession(alice),
      authenticator: "anonymous",
    })
  );
  assert.throws(() =>
    authenticatedSessionOf({
      ...principalForSession(alice),
      attributes: { plantId: alice.plantId, appSessionId: "raw-cookie" },
    })
  );
});

test("concurrent and nested transport auth scopes never share a session", async () => {
  const seen = await Promise.all(
    [alice, bob].map((session) =>
      withAuthenticatedSessionId(session.appSessionId, async () => {
        await Promise.resolve();
        assert.equal(authenticatedSessionId(), session.appSessionId);
        withAuthenticatedSessionId("nested", () =>
          assert.equal(authenticatedSessionId(), "nested")
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        return authenticatedSessionId();
      })
    )
  );
  assert.deepEqual(seen, [alice.appSessionId, bob.appSessionId]);
  assert.equal(authenticatedSessionId(), undefined);
});

test("task patches retain earlier choices across short replies and reject stale writes", () => {
  const first = applyTaskPatch(emptyTaskState(), {
    expectedRevision: 0,
    goal: "Invite core team to orientation",
    facts: [
      { key: "date", value: "2026-09-27", source: "user" },
      { key: "time", value: "10:00", source: "user" },
    ],
    pendingQuestion: "How long?",
  });
  const next = applyTaskPatch(first, {
    expectedRevision: 1,
    facts: [{ key: "durationMinutes", value: "120", source: "user" }],
    pendingQuestion: null,
  });
  assert.equal(next.facts.length, 3);
  assert.equal(next.goal, first.goal);
  assert.equal(next.pendingQuestion, null);
  assert.throws(() =>
    applyTaskPatch(next, { expectedRevision: 1, goal: "stale" })
  );
  assert.equal(
    taskPatchSchema.safeParse({ expectedRevision: 2, approved: true }).success,
    false
  );
  assert.equal(
    taskPatchSchema.safeParse({ expectedRevision: 2, actor: alice }).success,
    false
  );
});

test("presentation uses only current-turn registry results, not model draft facts", () => {
  const entry = {
    reference: "call-1",
    turnId: "turn-1",
    capability: "people.query",
  };
  const artifact = { kind: "read", title: "People", items: [] };
  const records = collectResult([], entry, artifact);
  assert.deepEqual(findResult(records, "call-1", "turn-1")?.artifact, artifact);
  assert.equal(findResult(records, "call-1", "turn-2"), undefined);
  assert.equal(findResult(records, "invented", "turn-1"), undefined);
  assert.deepEqual(
    collectResult([], entry, { kind: "confirmation", approved: true }),
    []
  );
  assert.deepEqual(collectResult([], entry, { status: "unavailable" }), []);
  assert.equal(
    collectResult(
      records,
      { ...entry, reference: "call-2", turnId: "turn-2" },
      artifact
    ).length,
    1
  );
});
