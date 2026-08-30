import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  EVRY_PEOPLE_CSV_MAX_BYTES,
  evryPeopleStagedAttachmentStorageKey,
  openEvryPeopleAttachmentReference,
  readExactEvryPeopleAttachment,
  removeEvryPeopleAttachment,
  stageEvryPeopleAttachment,
  sweepExpiredEvryPeopleAttachments,
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

test("CSV preview returns immutable inline bytes without writing object storage", async () => {
  const bytes = Buffer.from("First Name *,Last Name *\nAda,Lovelace");
  let storageWrites = 0;
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
    store: async (key) => {
      storageWrites += 1;
      return key;
    },
  });
  assert.ok(result);
  assert.equal(storageWrites, 0);
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
      read: async () => {
        throw new Error("preview must not read object storage");
      },
    })
  );
});

test("photo and commitment previews keep their exact bytes inline without writing object storage", async () => {
  const cases = [
    {
      kind: "person_photo" as const,
      file: file("photo.png", "image/png", Buffer.from("photo-bytes")),
    },
    {
      kind: "commitment_document" as const,
      file: file(
        "commitment.pdf",
        "application/pdf",
        Buffer.from("commitment-bytes")
      ),
    },
  ];
  let storageWrites = 0;
  for (const candidate of cases) {
    const result = await stageEvryPeopleAttachment({
      actor: ACTOR,
      kind: candidate.kind,
      personId: ACTOR.userId,
      file: candidate.file,
      now: NOW,
      secret: SECRET,
      loadPerson: async () => ({}) as never,
      store: async (key) => {
        storageWrites += 1;
        return key;
      },
    });
    assert.ok(result);
    const exact = await readExactEvryPeopleAttachment({
      reference: result.reference,
      actor: ACTOR,
      expectedKind: candidate.kind,
      expectedDigest: result.metadata.digest,
      now: NOW,
      secret: SECRET,
      read: async () => {
        throw new Error("preview must not read object storage");
      },
    });
    assert.ok(exact);
    assert.deepEqual(
      exact.bytes,
      Buffer.from(await candidate.file.arrayBuffer())
    );
  }
  assert.equal(storageWrites, 0);
});

test("concurrent identical previews own distinct inline references and no staged objects", async () => {
  const bytes = Buffer.from("First Name *,Last Name *\nAda,Lovelace");
  let storageWrites = 0;
  const stage = () =>
    stageEvryPeopleAttachment({
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
      store: async (key) => {
        storageWrites += 1;
        return key;
      },
    });
  const [first, second] = await Promise.all([stage(), stage()]);
  assert.ok(first && second);
  assert.notEqual(first.reference, second.reference);
  assert.equal(storageWrites, 0);
  let removals = 0;
  assert.equal(
    await removeEvryPeopleAttachment({
      actor: ACTOR,
      reference: first.reference,
      expectedKind: "people_csv",
      secret: SECRET,
      remove: async () => {
        removals += 1;
      },
    }),
    true
  );
  assert.equal(removals, 0);
  assert.ok(
    await readExactEvryPeopleAttachment({
      actor: ACTOR,
      reference: second.reference,
      expectedKind: "people_csv",
      expectedDigest: second.metadata.digest,
      now: NOW,
      secret: SECRET,
      read: async () => {
        throw new Error("preview must not read object storage");
      },
    })
  );
});

test("inline reference cleanup remains actor-scoped after expiry and performs no object delete", async () => {
  const bytes = Buffer.from("First Name *,Last Name *\nAda,Lovelace");
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
    store: async (key) => key,
  });
  assert.ok(result);
  const removed: string[] = [];
  assert.equal(
    await removeEvryPeopleAttachment({
      actor: OTHER_ACTOR,
      reference: result.reference,
      expectedKind: "people_csv",
      secret: SECRET,
      remove: async (key) => void removed.push(key),
    }),
    false
  );
  assert.equal(
    await removeEvryPeopleAttachment({
      actor: ACTOR,
      reference: result.reference,
      expectedKind: "people_csv",
      secret: SECRET,
      remove: async (key) => void removed.push(key),
    }),
    true
  );
  assert.equal(removed.length, 0);
});

test("expired unclaimed attachments sweep idempotently and retry failed deletes", async () => {
  const digest = "a".repeat(64);
  const expired = evryPeopleStagedAttachmentStorageKey({
    actor: ACTOR,
    expiresAt: new Date(NOW.getTime() - 1),
    uploadId: "10000000-0000-4000-8000-000000000010",
    digest,
    extension: "csv",
  });
  const future = evryPeopleStagedAttachmentStorageKey({
    actor: ACTOR,
    expiresAt: new Date(NOW.getTime() + 60_000),
    uploadId: "10000000-0000-4000-8000-000000000011",
    digest: "b".repeat(64),
    extension: "csv",
  });
  const keys = [expired, future, `${expired}.unexpected`];
  let fail = true;
  const removed: string[] = [];
  const sweep = () =>
    sweepExpiredEvryPeopleAttachments({
      actor: ACTOR,
      now: NOW,
      list: async () => keys,
      remove: async (key) => {
        if (fail) {
          fail = false;
          throw new Error("temporary object-store failure");
        }
        removed.push(key);
      },
    });

  assert.deepEqual(await sweep(), { removed: 0, failed: 1 });
  assert.deepEqual(await sweep(), { removed: 1, failed: 0 });
  assert.deepEqual(removed, [expired]);
});
