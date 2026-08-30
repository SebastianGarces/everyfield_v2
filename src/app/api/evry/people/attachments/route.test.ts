import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { UnauthorizedError } from "@/lib/auth/unauthorized";
import { EvryConversationIdempotencyError } from "@/lib/evry/conversations/repository";
import {
  finalizeEvryPeopleAttachmentUpload,
  prepareEvryPeopleAttachmentUpload,
  storeEvryPeopleAttachmentChunk,
} from "@/lib/evry/capabilities/people/attachments";
import {
  EVRY_PEOPLE_ATTACHMENT_PLATFORM_BODY_CAP_BYTES,
  EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH,
} from "@/lib/evry/capabilities/people/attachment-contract";
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
import { MAX_COMMITMENT_FILE_SIZE } from "@/lib/people/commitment-document";

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

test("a maximum 10 MiB commitment traverses compact staged and plan contracts below the platform cap", async () => {
  const actor = {
    userId: "10000000-0000-4000-8000-000000000001",
    plantId: "20000000-0000-4000-8000-000000000001",
    seat: "owner",
  } as unknown as EvryPlantActor;
  const secret = "max-file-contract-secret";
  const personId = "30000000-0000-4000-8000-000000000001";
  const bytes = Buffer.alloc(MAX_COMMITMENT_FILE_SIZE, 0x61);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const objects = new Map<
    string,
    Readonly<{ body: Buffer; contentType: string }>
  >();
  const handler = createEvryPeopleAttachmentPost({
    requireViewer: async () => actor,
    authorizeEffect: async () => ({ actor }) as never,
    prepare: (input) =>
      prepareEvryPeopleAttachmentUpload({
        ...input,
        secret,
        loadPerson: async () => ({}) as never,
      }),
    storeChunk: (input) =>
      storeEvryPeopleAttachmentChunk({
        ...input,
        secret,
        store: async (key, body, contentType) => {
          objects.set(key, { body: Buffer.from(body), contentType });
          return key;
        },
      }),
    finalize: (input) =>
      finalizeEvryPeopleAttachmentUpload({
        ...input,
        secret,
        read: async (key) => objects.get(key) ?? null,
      }),
  });
  const prepareBody = JSON.stringify({
    action: "prepare",
    kind: "commitment_document",
    personId,
    name: "commitment.pdf",
    type: "application/pdf",
    size: bytes.length,
    digest,
  });
  const prepareResponse = await handler(
    new Request("https://example.test/api/evry/people/attachments", {
      method: "POST",
      body: prepareBody,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(prepareBody)),
      },
    })
  );
  assert.equal(prepareResponse.status, 200);
  const prepared = (await prepareResponse.json()) as {
    reference: string;
    chunkBytes: number;
    chunkCount: number;
  };
  assert.equal(prepared.chunkCount, 4);
  assert.equal(objects.size, 0, "prepare must not write object storage");
  assert.ok(
    prepared.reference.length <=
      EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH
  );

  for (let index = 0; index < prepared.chunkCount; index += 1) {
    const form = new FormData();
    form.set("action", "chunk");
    form.set("kind", "commitment_document");
    form.set("reference", prepared.reference);
    form.set("index", String(index));
    form.set(
      "chunk",
      new File(
        [
          bytes.subarray(
            index * prepared.chunkBytes,
            (index + 1) * prepared.chunkBytes
          ),
        ],
        "commitment.pdf.part",
        { type: "application/octet-stream" }
      )
    );
    const encoded = new Response(form);
    const encodedBytes = await encoded.arrayBuffer();
    assert.ok(
      encodedBytes.byteLength < EVRY_PEOPLE_ATTACHMENT_PLATFORM_BODY_CAP_BYTES
    );
    const response = await handler(
      new Request("https://example.test/api/evry/people/attachments", {
        method: "POST",
        body: encodedBytes,
        headers: {
          "content-type": encoded.headers.get("content-type")!,
          "content-length": String(encodedBytes.byteLength),
        },
      })
    );
    assert.equal(response.status, 200);
  }
  assert.equal(objects.size, 4);
  assert.ok([...objects.keys()].every((key) => key.startsWith("evry-inputs/")));

  const finalizeBody = JSON.stringify({
    action: "finalize",
    kind: "commitment_document",
    reference: prepared.reference,
  });
  const stagedResponse = await handler(
    new Request("https://example.test/api/evry/people/attachments", {
      method: "POST",
      body: finalizeBody,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(finalizeBody)),
      },
    })
  );
  assert.equal(stagedResponse.status, 200);
  const stagedText = await stagedResponse.text();
  assert.doesNotMatch(stagedText, /bytesBase64Url|YWFhYWFhYWFh/);
  assert.ok(
    Buffer.byteLength(stagedText) <
      EVRY_PEOPLE_ATTACHMENT_PLATFORM_BODY_CAP_BYTES
  );
  const staged = JSON.parse(stagedText) as {
    reference: string;
    metadata: { digest: string };
  };
  const planBody = JSON.stringify({
    kind: "commitment_document",
    reference: staged.reference,
    attachmentDigest: staged.metadata.digest,
    commitmentType: "core_group",
    signedDate: "2026-08-30",
    witness: null,
    notes: null,
    conversationId: null,
    requestKey: "40000000-0000-4000-8000-000000000001",
  });
  assert.ok(Buffer.byteLength(planBody) <= EVRY_PEOPLE_PLAN_MAX_BYTES);
  assert.ok(
    Buffer.byteLength(planBody) < EVRY_PEOPLE_ATTACHMENT_PLATFORM_BODY_CAP_BYTES
  );
});

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
  const body = JSON.stringify({
    action: "prepare",
    kind: "commitment_document",
    personId: "30000000-0000-4000-8000-000000000001",
    name: "commitment.webp",
    type: "image/webp",
    size: 4,
    digest: "a".repeat(64),
  });
  let preparations = 0;
  const response = await createEvryPeopleAttachmentPost({
    requireViewer: async () => actor,
    authorizeEffect: async () => ({ actor }) as never,
    prepare: async () => {
      preparations += 1;
      return null;
    },
  })(
    new Request("https://example.test/api/evry/people/attachments", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      },
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    status: "invalid",
    reason: "unsupported_file_type",
  });
  assert.equal(preparations, 0);
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
