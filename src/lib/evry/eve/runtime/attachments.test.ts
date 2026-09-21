import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  sealEvryPeopleAttachmentReference,
  openEvryPeopleAttachmentReference,
  readExactEvryPeopleAttachment,
} from "@/lib/evry/capabilities/people/attachments";
import { EVRY_PEOPLE_ATTACHMENT_CHUNK_BYTES } from "@/lib/evry/capabilities/people/attachment-contract";
import {
  createEveAttachmentService,
  type EveAttachmentStore,
} from "./attachments";
import {
  eveAttachmentInputSchema,
  eveFilePreparations,
  type EveAttachmentKind,
} from "./attachment-contract";
import { selectedEvePreparationSchema } from "../preparation";
import { eveRuntimeToolSchema } from "./tool-schemas";
import {
  bindEveAttachmentContext,
  validateEveMessageRequest,
} from "./transport-policy";
import { evePageHintMessage } from "./client-context";

const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "10000000-0000-4000-8000-000000000002",
  sessionId: "fixture-eve-session",
};
const personId = "10000000-0000-4000-8000-000000000003";
const secret = "isolated-attachment-contract-signing-secret";
const instant = new Date("2026-09-20T12:00:00.000Z");
const bytes = Buffer.from("firstName,lastName\nAlex,Test");
const digest = createHash("sha256").update(bytes).digest("hex");
function fixture(kind: EveAttachmentKind = "people_csv") {
  let now = instant;
  let authorized = true;
  let storedBytes = bytes;
  let archived = false;
  const rows: Parameters<EveAttachmentStore["insert"]>[0][] = [];
  const reference = sealEvryPeopleAttachmentReference(
    {
      version: 3,
      kind,
      actorUserId: actor.userId,
      plantId: actor.plantId,
      personId: kind === "people_csv" ? null : personId,
      digest,
      contentType: "text/csv",
      size: bytes.length,
      originalName: "people.csv",
      expiresAt: new Date(instant.getTime() + 30 * 60_000).toISOString(),
      uploadId: "10000000-0000-4000-8000-000000000004",
      chunkBytes: EVRY_PEOPLE_ATTACHMENT_CHUNK_BYTES,
      chunkCount: 1,
    },
    secret
  );
  const store: EveAttachmentStore = {
    async insert(row) {
      if (
        !archived &&
        row.sessionId === actor.sessionId &&
        row.userId === actor.userId &&
        row.churchId === actor.plantId &&
        !rows.some(
          (existing) =>
            existing.sessionId === row.sessionId &&
            existing.referenceHash === row.referenceHash
        )
      )
        rows.push(row);
    },
    async find(scope, key, asOf) {
      return (
        rows.find(
          (row) =>
            !archived &&
            row.sessionId === scope.sessionId &&
            row.churchId === scope.plantId &&
            row.userId === scope.userId &&
            row.expiresAt > asOf &&
            ("id" in key
              ? row.id === key.id
              : row.referenceHash === key.referenceHash)
        ) ?? null
      );
    },
  };
  const restart = () =>
    createEveAttachmentService({
      store,
      authorize: async () => authorized,
      now: () => now,
      open: (input) => openEvryPeopleAttachmentReference({ ...input, secret }),
      readExact: (input) =>
        readExactEvryPeopleAttachment({
          ...input,
          secret,
          read: async () => ({
            body: storedBytes,
            contentType: "application/octet-stream",
          }),
        }),
    });
  const service = restart();
  return {
    service,
    restart,
    reference,
    rows,
    bind: () => service.bind(actor, { reference, digest, kind }),
    setNow: (value: Date) => {
      now = value;
    },
    revoke: () => {
      authorized = false;
    },
    changeBytes: () => {
      storedBytes = Buffer.from("different file");
    },
    archive: () => {
      archived = true;
    },
  };
}

test("binding preserves native signature/digest and reuses one ID across retries and service restarts", async () => {
  const f = fixture();
  const first = await f.bind();
  assert.ok(first);
  assert.deepEqual(await f.bind(), first);
  assert.equal(f.rows.length, 1);
  const restarted = f.restart();
  assert.deepEqual(
    await restarted.bind(actor, {
      reference: f.reference,
      digest,
      kind: "people_csv",
    }),
    first
  );
  const resolved = await restarted.resolve(
    actor,
    first.attachmentId,
    "people_csv"
  );
  assert.equal(resolved?.reference, f.reference);
  assert.equal(resolved?.digest, digest);
  assert.equal(JSON.stringify(first).includes(f.reference), false);
  assert.equal(JSON.stringify(first).includes(digest), false);
  assert.equal(
    await f.service.resolve({ ...actor, userId: personId }, first.attachmentId),
    null
  );
  assert.equal(
    await f.service.resolve(
      { ...actor, plantId: personId },
      first.attachmentId
    ),
    null
  );
  assert.equal(
    await f.service.resolve(
      { ...actor, sessionId: "other-session" },
      first.attachmentId
    ),
    null
  );
  assert.equal(
    await f.service.resolve(actor, first.attachmentId, "person_photo"),
    null
  );
  assert.equal(await f.service.resolve(actor, personId), null);
  f.revoke();
  assert.equal(await f.service.resolve(actor, first.attachmentId), null);
});

test("bad signature, digest, bytes, exact expiry and archived conversation never bind or resolve", async () => {
  const f = fixture();
  assert.equal(
    await f.service.bind(actor, {
      kind: "people_csv",
      reference: `${f.reference}x`,
      digest,
    }),
    null
  );
  assert.equal(
    await f.service.bind(actor, {
      kind: "people_csv",
      reference: f.reference,
      digest: "0".repeat(64),
    }),
    null
  );
  f.changeBytes();
  assert.equal(await f.bind(), null);
  assert.equal(f.rows.length, 0);
  const valid = fixture();
  const attachment = await valid.bind();
  assert.ok(attachment);
  valid.setNow(new Date(instant.getTime() + 30 * 60_000));
  assert.equal(
    await valid.service.resolve(actor, attachment.attachmentId),
    null
  );
  assert.equal(await valid.bind(), null);
  const archived = fixture();
  const bound = await archived.bind();
  assert.ok(bound);
  archived.archive();
  assert.equal(await archived.service.resolve(actor, bound.attachmentId), null);
});

test("photo and commitment targets remain the signed person, never model input", async () => {
  for (const kind of ["person_photo", "commitment_document"] as const) {
    const f = fixture(kind);
    const bound = await f.bind();
    assert.ok(bound);
    assert.equal(bound.personId, personId);
    const resolved = await f.service.resolve(actor, bound.attachmentId, kind);
    assert.equal(
      openEvryPeopleAttachmentReference({
        actor,
        reference: resolved!.reference,
        expectedKind: kind,
        now: instant,
        secret,
      })?.personId,
      personId
    );
  }
});

test("all Eve file tool schemas use IDs, retain native fields and reject raw references or target overrides", () => {
  assert.deepEqual(
    z.toJSONSchema(eveRuntimeToolSchema("files.inspect")),
    z.toJSONSchema(eveAttachmentInputSchema)
  );
  for (const [operation] of eveFilePreparations) {
    const schema = selectedEvePreparationSchema([operation]);
    const args = {
      attachmentId: personId,
      ...(operation === "people.attach_commitment"
        ? { commitmentType: "core_group", signedDate: "2026-09-20" }
        : {}),
    };
    assert.equal(
      schema.safeParse({ request: { operation, arguments: args } }).success,
      true,
      operation
    );
    for (const extra of [
      { reference: "signed-token" },
      { personId },
      { attachmentDigest: digest },
      { approved: true },
    ])
      assert.equal(
        schema.safeParse({
          request: { operation, arguments: { ...args, ...extra } },
        }).success,
        false,
        operation
      );
    assert.equal(
      JSON.stringify(z.toJSONSchema(schema, { io: "input" })).includes(
        '"reference"'
      ),
      false
    );
  }
});

test("genuine clientContext binding keeps page context, replaces metadata, and refuses legacy tokens before dispatch", async () => {
  const f = fixture();
  const bound = await f.bind();
  assert.ok(bound);
  const owner = { ...actor, appSessionId: "a".repeat(64) };
  const request = (clientContext: unknown, path = actor.sessionId) =>
    new Request(
      `https://preview.example/eve/v1/session${path ? `/${path}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          message: "Review this CSV only.",
          clientContext,
        }),
      }
    );
  for (const asString of [true, false]) {
    const context = {
      pageContext: { kind: "person", recordId: personId },
      attachment: { attachmentId: bound.attachmentId },
    };
    const req = request(asString ? JSON.stringify(context) : context);
    assert.equal(await validateEveMessageRequest(req), true);
    const result = await bindEveAttachmentContext(
      req,
      owner,
      f.service.resolve
    );
    assert.ok(result);
    const body = await result.json();
    assert.deepEqual(body.clientContext.attachment, bound);
    assert.equal(body.clientContext.pageContext.recordId, personId);
    assert.match(evePageHintMessage(result), new RegExp(personId));
    assert.equal(JSON.stringify(body).includes(f.reference), false);
    assert.equal(JSON.stringify(body).includes(digest), false);
  }
  const legacy = { attachment: { reference: f.reference, kind: "people_csv" } };
  for (const context of [
    legacy,
    JSON.stringify(legacy),
    [JSON.stringify(legacy)],
    {
      attachment: { attachmentId: bound.attachmentId, reference: f.reference },
    },
  ])
    assert.equal(
      await bindEveAttachmentContext(
        request(context),
        owner,
        f.service.resolve
      ),
      null
    );
  assert.equal(
    await bindEveAttachmentContext(
      request(
        { attachment: { attachmentId: bound.attachmentId } },
        "foreign-session"
      ),
      owner,
      f.service.resolve
    ),
    null
  );
  assert.equal(
    await bindEveAttachmentContext(
      request({ attachment: { attachmentId: bound.attachmentId } }, ""),
      owner,
      f.service.resolve
    ),
    null
  );
});
