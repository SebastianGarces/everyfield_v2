import assert from "node:assert/strict";
import { test } from "node:test";

import { UnauthorizedError } from "@/lib/auth/unauthorized";
import { EvryConversationIdempotencyError } from "@/lib/evry/conversations/repository";
import {
  EvryPlantViewerRefusalError,
  type EvryPlantActor,
} from "@/lib/evry/eligibility/viewer";

import {
  createEvryPeopleAttachmentPlanPost,
  EVRY_PEOPLE_PLAN_MAX_BYTES,
} from "./plan/route";
import {
  createEvryPeopleAttachmentPost,
  EVRY_PEOPLE_MULTIPART_MAX_BYTES,
} from "./route";

class ObservedMultipartRequest extends Request {
  formReads = 0;

  override formData(): Promise<FormData> {
    this.formReads++;
    return Promise.resolve(new FormData());
  }
}

class ObservedJsonRequest extends Request {
  jsonReads = 0;

  override json(): Promise<unknown> {
    this.jsonReads++;
    return Promise.resolve({});
  }
}

for (const refusal of [
  new UnauthorizedError(),
  new EvryPlantViewerRefusalError(),
]) {
  test(`attachment upload authenticates before multipart parsing: ${refusal.name}`, async () => {
    const request = new ObservedMultipartRequest(
      "https://example.test/api/evry/people/attachments",
      { method: "POST", headers: { "content-length": "100" } }
    );
    const post = createEvryPeopleAttachmentPost({
      requireViewer: () => Promise.reject(refusal),
    });

    const response = await post(request);

    assert.equal(response.status, 404);
    assert.equal(request.formReads, 0);
    assert.deepEqual(await response.json(), { status: "unavailable" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });
}

test("multipart and plan routes reject oversized bodies before parsing", async () => {
  const actor = {
    userId: "10000000-0000-4000-8000-000000000001",
    plantId: "20000000-0000-4000-8000-000000000001",
    seat: "owner",
  } as unknown as EvryPlantActor;
  const multipart = new ObservedMultipartRequest(
    "https://example.test/api/evry/people/attachments",
    {
      method: "POST",
      headers: {
        "content-length": String(EVRY_PEOPLE_MULTIPART_MAX_BYTES + 1),
      },
    }
  );
  const plan = new ObservedJsonRequest(
    "https://example.test/api/evry/people/attachments/plan",
    {
      method: "POST",
      headers: { "content-length": String(EVRY_PEOPLE_PLAN_MAX_BYTES + 1) },
    }
  );

  const [multipartResponse, planResponse] = await Promise.all([
    createEvryPeopleAttachmentPost({
      requireViewer: () => Promise.resolve(actor),
    })(multipart),
    createEvryPeopleAttachmentPlanPost({
      requireViewer: () => Promise.resolve(actor),
    })(plan),
  ]);

  assert.equal(multipartResponse.status, 413);
  assert.equal(planResponse.status, 413);
  assert.equal(multipart.formReads, 0);
  assert.equal(plan.jsonReads, 0);
});

test("commitment WebP receives the specific canonical file-type refusal", async () => {
  const actor = {
    userId: "10000000-0000-4000-8000-000000000001",
    plantId: "20000000-0000-4000-8000-000000000001",
    seat: "owner",
  } as unknown as EvryPlantActor;
  const form = new FormData();
  form.set("kind", "commitment_document");
  form.set("personId", "30000000-0000-4000-8000-000000000001");
  form.set(
    "file",
    new File(["webp"], "commitment.webp", { type: "image/webp" })
  );
  let stages = 0;
  const response = await createEvryPeopleAttachmentPost({
    requireViewer: async () => actor,
    authorizeEffect: async () => ({ actor }) as never,
    stage: async () => {
      stages += 1;
      return null;
    },
  })(
    new Request("https://example.test/api/evry/people/attachments", {
      method: "POST",
      body: form,
      headers: { "content-length": "1024" },
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    status: "invalid",
    reason: "unsupported_file_type",
  });
  assert.equal(stages, 0);
});

test("a definitely refused attachment plan removes its exact staged input", async () => {
  const actor = {
    userId: "10000000-0000-4000-8000-000000000001",
    plantId: "20000000-0000-4000-8000-000000000001",
    seat: "owner",
  } as unknown as EvryPlantActor;
  const body = JSON.stringify({
    kind: "person_photo",
    reference: "signed-staged-reference",
    attachmentDigest: "a".repeat(64),
    conversationId: null,
    requestKey: "30000000-0000-4000-8000-000000000001",
  });
  const removed: unknown[] = [];
  const response = await createEvryPeopleAttachmentPlanPost({
    requireViewer: () => Promise.resolve(actor),
    openAttachment: () =>
      ({
        kind: "person_photo",
        digest: "a".repeat(64),
        personId: actor.userId,
      }) as never,
    recoverReview: async () => null,
    proposePhoto: async () => null,
    removeAttachment: async (input) => {
      removed.push(input);
      return true;
    },
  })(
    new Request("https://example.test/api/evry/people/attachments/plan", {
      method: "POST",
      body,
      headers: { "content-length": String(Buffer.byteLength(body)) },
    })
  );

  assert.equal(response.status, 404);
  assert.deepEqual(removed, [
    {
      actor,
      reference: "signed-staged-reference",
      expectedKind: "person_photo",
    },
  ]);
});

test("a different staged digest cannot recover an old response and is removed", async () => {
  const actor = {
    userId: "10000000-0000-4000-8000-000000000001",
    plantId: "20000000-0000-4000-8000-000000000001",
    seat: "owner",
  } as unknown as EvryPlantActor;
  const reference = "same-metadata-different-bytes-reference";
  const body = JSON.stringify({
    kind: "people_csv",
    reference,
    attachmentDigest: "b".repeat(64),
    duplicateResolutions: {},
    conversationId: null,
    requestKey: "30000000-0000-4000-8000-000000000001",
  });
  const removed: unknown[] = [];
  const response = await createEvryPeopleAttachmentPlanPost({
    requireViewer: () => Promise.resolve(actor),
    openAttachment: () =>
      ({ kind: "people_csv", digest: "b".repeat(64) }) as never,
    recoverReview: async () => {
      throw new EvryConversationIdempotencyError();
    },
    removeAttachment: async (input) => {
      removed.push(input);
      return true;
    },
  })(
    new Request("https://example.test/api/evry/people/attachments/plan", {
      method: "POST",
      body,
      headers: { "content-length": String(Buffer.byteLength(body)) },
    })
  );

  assert.equal(response.status, 409);
  assert.deepEqual(removed, [{ actor, reference, expectedKind: "people_csv" }]);
});

test("a raw plan request-key race removes the losing staged input", async () => {
  const actor = {
    userId: "10000000-0000-4000-8000-000000000001",
    plantId: "20000000-0000-4000-8000-000000000001",
    seat: "owner",
  } as unknown as EvryPlantActor;
  const reference = "losing-race-staged-reference";
  const body = JSON.stringify({
    kind: "person_photo",
    reference,
    attachmentDigest: "c".repeat(64),
    conversationId: null,
    requestKey: "30000000-0000-4000-8000-000000000001",
  });
  const removed: unknown[] = [];
  const response = await createEvryPeopleAttachmentPlanPost({
    requireViewer: () => Promise.resolve(actor),
    openAttachment: () =>
      ({
        kind: "person_photo",
        digest: "c".repeat(64),
        personId: actor.userId,
      }) as never,
    recoverReview: async () => null,
    proposePhoto: async () => {
      throw {
        code: "23505",
        constraint: "evry_action_plans_actor_request_unique_idx",
      };
    },
    removeAttachment: async (input) => {
      removed.push(input);
      return true;
    },
  })(
    new Request("https://example.test/api/evry/people/attachments/plan", {
      method: "POST",
      body,
      headers: { "content-length": String(Buffer.byteLength(body)) },
    })
  );

  assert.equal(response.status, 409);
  assert.deepEqual(removed, [
    { actor, reference, expectedKind: "person_photo" },
  ]);
});

for (const refusal of [
  new UnauthorizedError(),
  new EvryPlantViewerRefusalError(),
]) {
  test(`attachment plan authenticates before JSON parsing: ${refusal.name}`, async () => {
    const request = new ObservedJsonRequest(
      "https://example.test/api/evry/people/attachments/plan",
      { method: "POST", headers: { "content-length": "100" } }
    );
    const response = await createEvryPeopleAttachmentPlanPost({
      requireViewer: () => Promise.reject(refusal),
    })(request);

    assert.equal(response.status, 404);
    assert.equal(request.jsonReads, 0);
    assert.deepEqual(await response.json(), { status: "unavailable" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });
}
