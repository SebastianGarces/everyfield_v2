import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  EVRY_PEOPLE_CSV_MAX_BYTES,
  openEvryPeopleAttachmentReference,
  readExactEvryPeopleAttachment,
  stageEvryPeopleAttachment,
} from "./attachments";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
};
const OTHER_ACTOR = {
  ...ACTOR,
  plantId: "30000000-0000-4000-8000-000000000001",
};
const SECRET = "test-only-attachment-secret";
const NOW = new Date("2026-08-29T08:00:00.000Z");

function file(
  name: string,
  type: string,
  bytes: Buffer,
  declaredSize = bytes.length
) {
  return {
    name,
    type,
    size: declaredSize,
    async arrayBuffer() {
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
    },
  };
}

test("malformed, oversize, and foreign attachments refuse before storage", async () => {
  let stores = 0;
  const store = async () => {
    stores++;
    return "stored";
  };
  assert.equal(
    await stageEvryPeopleAttachment({
      actor: ACTOR,
      kind: "people_csv",
      personId: null,
      file: file(
        "people.csv",
        "text/csv",
        Buffer.from("x"),
        EVRY_PEOPLE_CSV_MAX_BYTES + 1
      ),
      secret: SECRET,
      store,
    }),
    null
  );
  assert.equal(
    await stageEvryPeopleAttachment({
      actor: ACTOR,
      kind: "person_photo",
      personId: ACTOR.userId,
      file: file("photo.pdf", "application/pdf", Buffer.from("pdf")),
      secret: SECRET,
      store,
    }),
    null
  );
  assert.equal(
    await stageEvryPeopleAttachment({
      actor: ACTOR,
      kind: "person_photo",
      personId: ACTOR.userId,
      file: file("photo.png", "image/png", Buffer.from("png")),
      secret: SECRET,
      store,
      loadPerson: async () => null,
    }),
    null
  );
  assert.equal(stores, 0);
});

test("CSV staging returns an immutable actor and plant scoped digest reference", async () => {
  const bytes = Buffer.from("First Name *,Last Name *\nAda,Lovelace");
  let stored: { key: string; bytes: Buffer; type: string } | null = null;
  const result = await stageEvryPeopleAttachment({
    actor: ACTOR,
    kind: "people_csv",
    personId: null,
    file: file("people.csv", "text/csv", bytes),
    now: NOW,
    secret: SECRET,
    parseImport: async () => ({
      totalRows: 1,
      validRows: [],
      invalidRows: [],
      duplicateRows: [],
    }),
    store: async (key, body, type) => {
      stored = { key, bytes: body, type };
      return key;
    },
  });
  assert.ok(result && stored);
  assert.equal(
    result.metadata.digest,
    createHash("sha256").update(bytes).digest("hex")
  );
  assert.ok(
    openEvryPeopleAttachmentReference({
      reference: result.reference,
      actor: ACTOR,
      expectedKind: "people_csv",
      now: NOW,
      secret: SECRET,
    })
  );
  assert.equal(
    openEvryPeopleAttachmentReference({
      reference: result.reference,
      actor: OTHER_ACTOR,
      expectedKind: "people_csv",
      now: NOW,
      secret: SECRET,
    }),
    null
  );
  assert.equal(
    openEvryPeopleAttachmentReference({
      reference: `${result.reference}x`,
      actor: ACTOR,
      expectedKind: "people_csv",
      now: NOW,
      secret: SECRET,
    }),
    null
  );
  assert.ok(
    await readExactEvryPeopleAttachment({
      reference: result.reference,
      actor: ACTOR,
      expectedKind: "people_csv",
      expectedDigest: result.metadata.digest,
      now: NOW,
      secret: SECRET,
      read: async (key) =>
        stored && key === stored.key
          ? { body: stored.bytes, contentType: stored.type }
          : null,
    })
  );
});
