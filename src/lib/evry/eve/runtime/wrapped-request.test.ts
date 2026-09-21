import assert from "node:assert/strict";
import { test } from "node:test";
import {
  scopeEveCreationRequest,
  bindEveAttachmentContext,
} from "./transport-policy";

/** Nitro exposes bound methods/getters through a proxy, not native Request private slots. */
function wrapped(request: Request) {
  return new Proxy(request, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("creation scoping accepts framework-wrapped requests and preserves request identity", async () => {
  const request = wrapped(
    new Request("https://preview.example/eve/v1/session", {
      method: "POST",
      headers: {
        cookie: "session=fixture",
        "x-evry-operation-id": "fixture-operation-one",
        "content-type": "application/json",
      },
    })
  );
  const owner = { userId: "fixture-actor", plantId: "fixture-plant" };
  const scoped = await scopeEveCreationRequest(request, owner);
  assert.equal(scoped.url, request.url);
  assert.equal(scoped.method, "POST");
  assert.equal(scoped.headers.get("cookie"), "session=fixture");
  assert.match((await scoped.json()).operationId, /^[a-f0-9]{64}$/);
});

test("attachment binding accepts framework-wrapped requests without exposing tokens", async () => {
  const attachmentId = "10000000-0000-4000-8000-000000000001";
  const descriptor = {
    attachmentId,
    kind: "people_csv" as const,
    name: "people.csv",
    size: 20,
    personId: null,
  };
  const request = wrapped(
    new Request("https://preview.example/eve/v1/session/owned-session", {
      method: "POST",
      headers: {
        cookie: "session=fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: "Review this file",
        clientContext: { attachment: { attachmentId } },
      }),
    })
  );
  const bound = await bindEveAttachmentContext(
    request,
    { userId: "actor", plantId: "plant", appSessionId: "session" },
    async (scope, id) => {
      assert.equal(scope.sessionId, "owned-session");
      assert.equal(id, attachmentId);
      return {
        descriptor,
        reference: "private-signed-reference",
        digest: "a".repeat(64),
      };
    }
  );
  assert.ok(bound);
  assert.equal(bound.method, "POST");
  assert.equal(bound.headers.get("cookie"), "session=fixture");
  const body = await bound.json();
  assert.deepEqual(body.clientContext.attachment, descriptor);
  assert.ok(!JSON.stringify(body).includes("private-signed-reference"));
});
