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
import { EVE_APP_ROUTES, validateEveMessageRequest } from "./transport-policy";
import { mayClaimPreparation } from "./preparation-gate";
import { scrubJevRoutingPayload } from "./routing-privacy";
import { scopeEveCreationRequest } from "./transport-policy";
import { eveTraceMetadataSchema } from "./trace-policy";
import {
  evePageHintMessage,
  pageHintFromMessages,
  rememberEvePageHint,
} from "./client-context";

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
  assert.deepEqual(findResult(records, "call-1", "turn-1")?.artifacts, [
    artifact,
  ]);
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

test("native transport cannot add callbacks, delegate, upload or override output schemas", async () => {
  const post = (body: unknown) =>
    new Request("https://preview.example/eve/v1/session", {
      method: "POST",
      body: JSON.stringify(body),
    });
  assert.equal(
    await validateEveMessageRequest(
      post({
        message: "Hello",
        operationId: "request-1",
        mode: "conversation",
        capabilities: { requestInput: true },
      })
    ),
    true
  );
  for (const field of [
    "callback",
    "activityObserver",
    "outputSchema",
    "auth",
    "actor",
    "sessionId",
  ])
    assert.equal(
      await validateEveMessageRequest(
        post({ message: "Hello", [field]: "untrusted" })
      ),
      false,
      field
    );
  assert.equal(
    await validateEveMessageRequest(
      post({ message: [{ type: "file", data: "https://example.com/secret" }] })
    ),
    false
  );
  for (const route of [
    "GET /eve/v1/info",
    "GET /eve/v1/activity/:token",
    "POST /eve/v1/callback/:token",
    "GET /eve/v1/session/:parentSessionId/subagents/:callId/:childSessionId/stream",
  ])
    assert.equal(EVE_APP_ROUTES.has(route), false);
});

test("only trusted preparation results can be presented as confirmation cards", () => {
  const entry = {
    reference: "prepare-1",
    turnId: "turn-1",
    capability: "actions.prepare",
  };
  const confirmation = { kind: "confirmation", title: "Review orientation" };
  const records = collectResult([], entry, {
    body: "Review before sending",
    artifacts: [confirmation],
  });
  assert.deepEqual(findResult(records, "prepare-1", "turn-1")?.artifacts, [
    confirmation,
  ]);
  assert.deepEqual(
    collectResult(
      [],
      { ...entry, capability: "people.query" },
      { artifacts: [confirmation] }
    ),
    []
  );
});

test("preparation claim blocks parallel alternatives but permits durable replay and next turns", () => {
  const current = { turnId: "turn-1", callId: "prepare-1" };
  assert.equal(mayClaimPreparation(null, current), true);
  assert.equal(mayClaimPreparation(current, current), true);
  assert.equal(
    mayClaimPreparation(current, { ...current, callId: "parallel-2" }),
    false
  );
  assert.equal(
    mayClaimPreparation(current, { turnId: "turn-2", callId: "next" }),
    true
  );
});

test("telemetry accepts only approved metadata and refuses raw content or auth", () => {
  const safe = {
    operation: "model",
    name: "gpt-5.6-luna",
    status: "completed",
    durationMs: 25,
    inputTokens: 100,
  };
  assert.equal(eveTraceMetadataSchema.safeParse(safe).success, true);
  for (const key of [
    "message",
    "input",
    "output",
    "userId",
    "sessionId",
    "appSessionId",
    "error",
    "stack",
    "authorization",
    "secretKey",
  ])
    assert.equal(
      eveTraceMetadataSchema.safeParse({ ...safe, [key]: "private" }).success,
      false,
      key
    );
});

test("page context is a record hint, isolated by request and cleared when leaving a detail page", () => {
  const first = request("session", "POST");
  const second = request("session", "POST");
  const hint = { kind: "person", recordId: "person-1" } as const;
  rememberEvePageHint(first, { pageContext: hint });
  assert.deepEqual(
    pageHintFromMessages([
      { role: "user", content: evePageHintMessage(first) },
    ]),
    hint
  );
  assert.equal(
    pageHintFromMessages([
      { role: "user", content: evePageHintMessage(first) },
      { role: "user", content: evePageHintMessage(second) },
    ]),
    null
  );
  rememberEvePageHint(first, { pageContext: { ...hint, plantId: "attacker" } });
  assert.equal(
    pageHintFromMessages([
      { role: "user", content: evePageHintMessage(first) },
    ]),
    null
  );
});

test("creation retry identities cannot collide across accounts or churches", async () => {
  const make = () =>
    new Request("https://preview.example/eve/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Hello",
        operationId: "same-client-key",
      }),
    });
  const first = await (await scopeEveCreationRequest(make(), alice)).json();
  const retry = await (await scopeEveCreationRequest(make(), alice)).json();
  const other = await (await scopeEveCreationRequest(make(), bob)).json();
  assert.equal(first.operationId, retry.operationId);
  assert.notEqual(first.operationId, other.operationId);
  assert.equal(first.message, "Hello");
});

test("native client operation header is validated and converted into tenant-scoped creation identity", async () => {
  const { scopeEveCreationRequest, validateEveMessageRequest } =
    await import("./transport-policy");
  const make = (key: string) =>
    new Request("https://app.test/eve/v1/session", {
      method: "POST",
      headers: { "x-evry-operation-id": key },
      body: JSON.stringify({ message: "Hello" }),
    });
  const key = "a3d89218-33b8-4425-8c31-ff333fbb44dd";
  const request = make(key);
  assert.equal(await validateEveMessageRequest(request), true);
  const first = await (
    await scopeEveCreationRequest(request, { userId: "one", plantId: "plant" })
  ).json();
  const retry = await (
    await scopeEveCreationRequest(make(key), {
      userId: "one",
      plantId: "plant",
    })
  ).json();
  const other = await (
    await scopeEveCreationRequest(make(key), {
      userId: "two",
      plantId: "plant",
    })
  ).json();
  assert.equal(first.operationId, retry.operationId);
  assert.notEqual(first.operationId, other.operationId);
  assert.notEqual(first.operationId, key);
  assert.equal(await validateEveMessageRequest(make("bad")), false);
});

test("Jev routing scrubs known credential strings and nested secret facts without altering main task state", () => {
  const original = {
    request:
      "Use Bearer abcd.secret.123 and sk-proj-abcDEF1234567890 and password=hunter2",
    taskState: {
      facts: [
        { key: "apiKey", value: "arbitrarysecret" },
        { key: "date", value: "2026-09-27" },
      ],
      nested: { sessionId: "privatesession", authorization: "secret" },
    },
  };
  const safe = JSON.stringify(scrubJevRoutingPayload(original));
  for (const value of [
    "abcd.secret.123",
    "sk-proj-abcDEF1234567890",
    "hunter2",
    "arbitrarysecret",
    "privatesession",
  ])
    assert.equal(safe.includes(value), false);
  assert.equal(safe.includes("2026-09-27"), true);
  assert.equal(original.taskState.facts[0].value, "arbitrarysecret");
});
