import assert from "node:assert/strict";

import type { EvryPeopleFileStorage } from "@/lib/evry/capabilities/people/file-storage";

export const EVRY_PEOPLE_EFFECT_PROOF_SIGNING_SECRET =
  "evry-people-effect-proof-signing-secret";

type StoredObject = Readonly<{
  body: Buffer;
  contentType: string;
  lastModified: Date;
}>;

type StorageOperation = Readonly<{
  kind: "store" | "read" | "remove" | "list_keys" | "list_objects";
  key: string;
}>;

export type EvryPeopleEffectProofStorage = EvryPeopleFileStorage &
  Readonly<{
    assertCleaned(): void;
  }>;

/** One deterministic private bucket for the credential-free People proof. */
export function createEvryPeopleEffectProofStorage(): EvryPeopleEffectProofStorage {
  const objects = new Map<string, StoredObject>();
  const operations: StorageOperation[] = [];
  const lastModified = new Date("2000-01-01T00:00:00.000Z");

  const storage: EvryPeopleEffectProofStorage = {
    signingSecret: () => EVRY_PEOPLE_EFFECT_PROOF_SIGNING_SECRET,
    async store(key, bytes, contentType) {
      operations.push({ kind: "store", key });
      objects.set(key, {
        body: Buffer.from(bytes),
        contentType,
        lastModified,
      });
      return key;
    },
    async read(key) {
      operations.push({ kind: "read", key });
      const object = objects.get(key);
      return object
        ? {
            body: new Uint8Array(object.body),
            contentType: object.contentType,
          }
        : null;
    },
    async remove(key) {
      operations.push({ kind: "remove", key });
      objects.delete(key);
    },
    async listKeys(prefix) {
      operations.push({ kind: "list_keys", key: prefix });
      return [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .toSorted();
    },
    async listObjects(prefix) {
      operations.push({ kind: "list_objects", key: prefix });
      return [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, object]) => ({
          key,
          lastModified: new Date(object.lastModified),
        }))
        .toSorted((left, right) => left.key.localeCompare(right.key));
    },
    assertCleaned() {
      const stores = operations.filter(({ kind }) => kind === "store");
      const staged = stores.filter(({ key }) => key.startsWith("evry-inputs/"));
      const final = stores.filter(({ key }) => key.startsWith("people/"));
      const removed = new Set(
        operations.filter(({ kind }) => kind === "remove").map(({ key }) => key)
      );
      const read = new Set(
        operations.filter(({ kind }) => kind === "read").map(({ key }) => key)
      );
      const listed = new Set(
        operations
          .filter(({ kind }) => kind === "list_keys" || kind === "list_objects")
          .map(({ key }) => key)
      );

      assert.equal(
        staged.length,
        3,
        "proof must stage all three CSV/photo inputs"
      );
      assert.equal(final.length, 1, "proof must store one final person photo");
      for (const { key } of staged) {
        assert.ok(read.has(key), `staged object was never read: ${key}`);
        assert.ok(removed.has(key), `staged object was never removed: ${key}`);
      }
      assert.ok(removed.has(final[0]!.key), "final photo was never removed");
      assert.ok(
        [...listed].some((prefix) => prefix.startsWith("evry-inputs/")),
        "staged attachment sweep never used the proof adapter"
      );
      assert.ok(
        listed.has("people/"),
        "final photo sweep never used the adapter"
      );
      assert.ok(
        listed.has("commitments/"),
        "final commitment sweep never used the adapter"
      );
      assert.deepEqual([...objects.keys()], [], "proof leaked stored objects");
    },
  };

  return storage;
}
