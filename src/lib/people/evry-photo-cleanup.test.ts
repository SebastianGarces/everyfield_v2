import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvryAuditKey } from "@/lib/evry/audit/identity";

import {
  claimEvryPersonPhotoMutation,
  EVRY_FINAL_OBJECT_GRACE_MS,
  sweepEvryPersonPhotoObjects,
} from "./person-photo";

const PLANT_ID = "10000000-0000-4000-8000-000000000001";
const PERSON_ID = "20000000-0000-4000-8000-000000000001";
const PREFIX = `people/${PLANT_ID}/${PERSON_ID}/`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("photo cleanup preserves the current object and retries failed orphan deletes", async () => {
  const current = `${PREFIX}current.jpg`;
  const orphan = `${PREFIX}orphan.jpg`;
  const foreign = `people/30000000-0000-4000-8000-000000000001/${PERSON_ID}/foreign.jpg`;
  let fail = true;
  const removed: string[] = [];
  const old = new Date(NOW.getTime() - EVRY_FINAL_OBJECT_GRACE_MS - 1);
  const storage = {
    store: async () => undefined,
    list: async () =>
      [current, orphan, foreign].map((key) => ({ key, lastModified: old })),
    remove: async (key: string) => {
      if (fail) {
        fail = false;
        throw new Error("temporary object-store failure");
      }
      removed.push(key);
    },
  };
  const sweep = () =>
    sweepEvryPersonPhotoObjects({
      plantId: PLANT_ID,
      personId: PERSON_ID,
      storage,
      now: NOW,
      load: async () => ({ photoKey: current }),
    });

  assert.deepEqual(await sweep(), { removed: 0, failed: 1 });
  assert.deepEqual(await sweep(), { removed: 1, failed: 0 });
  assert.deepEqual(removed, [orphan]);
});

const NOW = new Date("2026-08-29T12:00:00.000Z");

test("photo cleanup rechecks references after listing and protects young objects", async () => {
  const becameCurrent = `${PREFIX}became-current.jpg`;
  const young = `${PREFIX}young.jpg`;
  let listed = false;
  const removed: string[] = [];
  const result = await sweepEvryPersonPhotoObjects({
    plantId: PLANT_ID,
    personId: PERSON_ID,
    now: NOW,
    storage: {
      store: async () => undefined,
      list: async () => {
        listed = true;
        return [
          {
            key: becameCurrent,
            lastModified: new Date(
              NOW.getTime() - EVRY_FINAL_OBJECT_GRACE_MS - 1
            ),
          },
          { key: young, lastModified: NOW },
        ];
      },
      remove: async (key) => void removed.push(key),
    },
    load: async () => {
      assert.equal(listed, true);
      return { photoKey: becameCurrent };
    },
  });
  assert.deepEqual(result, { removed: 0, failed: 0 });
  assert.deepEqual(removed, []);
});

test("photo cleanup cannot delete a concurrent retry's fresh final object", async () => {
  const oldKey = `${PREFIX}30000000-0000-4000-8000-000000000001.jpg`;
  const objects = new Map([
    [oldKey, new Date(NOW.getTime() - EVRY_FINAL_OBJECT_GRACE_MS - 1)],
  ]);
  const listed = deferred();
  const retryStored = deferred();
  const oldRemoved = deferred();
  let currentPhotoKey: string | null = null;
  let newKey: string | null = null;

  const sweep = sweepEvryPersonPhotoObjects({
    plantId: PLANT_ID,
    personId: PERSON_ID,
    now: NOW,
    storage: {
      store: async () => undefined,
      list: async () => {
        const snapshot = [...objects].map(([key, lastModified]) => ({
          key,
          lastModified,
        }));
        listed.resolve();
        return snapshot;
      },
      remove: async (key) => {
        objects.delete(key);
        oldRemoved.resolve();
      },
    },
    load: async () => {
      await retryStored.promise;
      return { photoKey: currentPhotoKey };
    },
  });

  await listed.promise;
  const retry = claimEvryPersonPhotoMutation({
    execution: {
      attemptId: "40000000-0000-4000-8000-000000000001",
      planId: "50000000-0000-4000-8000-000000000001",
      actorUserId: "60000000-0000-4000-8000-000000000001",
      plantId: PLANT_ID,
      fingerprint: "a".repeat(64),
      correlationId: "70000000-0000-4000-8000-000000000001",
      stepId: "upload-photo",
      capabilityIdentity: "people.crm.people.upload-person-photo",
    },
    effectKey: "b".repeat(64) as EvryAuditKey,
    personId: PERSON_ID,
    expectedDigest: null,
    mutation: {
      kind: "upload",
      attachmentDigest: "c".repeat(64),
      bytes: Buffer.from("photo retry"),
      contentType: "image/jpeg",
    },
    storage: {
      store: async (key) => {
        newKey = key;
        objects.set(key, NOW);
        retryStored.resolve();
      },
      list: async () => [],
      remove: async (key) => void objects.delete(key),
    },
    load: async () => ({ photoKey: currentPhotoKey }),
    recover: async () => null,
    claim: async () => {
      await oldRemoved.promise;
      currentPhotoKey = newKey;
      return { status: "completed", affectedCount: 1, excludedCount: 0 };
    },
  });

  assert.deepEqual(await Promise.all([sweep, retry]), [
    { removed: 1, failed: 0 },
    { status: "completed", affectedCount: 1, excludedCount: 0 },
  ]);
  assert.ok(newKey);
  assert.notEqual(newKey, oldKey);
  assert.equal(objects.has(oldKey), false);
  assert.equal(objects.has(newKey), true);
  assert.equal(currentPhotoKey, newKey);
});

test("photo claim response loss preserves the committed final object", async () => {
  const stored: string[] = [];
  const removed: string[] = [];
  let recoveryCalls = 0;
  let loadCalls = 0;
  const result = await claimEvryPersonPhotoMutation({
    execution: {
      attemptId: "30000000-0000-4000-8000-000000000001",
      planId: "40000000-0000-4000-8000-000000000001",
      actorUserId: "50000000-0000-4000-8000-000000000001",
      plantId: PLANT_ID,
      fingerprint: "a".repeat(64),
      correlationId: "60000000-0000-4000-8000-000000000001",
      stepId: "upload-photo",
      capabilityIdentity: "people.crm.people.upload-person-photo",
    },
    effectKey: "b".repeat(64) as EvryAuditKey,
    personId: PERSON_ID,
    expectedDigest: null,
    mutation: {
      kind: "upload",
      attachmentDigest: "c".repeat(64),
      bytes: Buffer.from("photo"),
      contentType: "image/jpeg",
    },
    storage: {
      store: async (key) => void stored.push(key),
      list: async () => [],
      remove: async (key) => void removed.push(key),
    },
    load: async () => {
      loadCalls++;
      return { photoKey: loadCalls === 1 ? null : stored[0]! };
    },
    recover: async () => {
      recoveryCalls++;
      return recoveryCalls === 1
        ? null
        : { status: "completed", affectedCount: 1, excludedCount: 0 };
    },
    claim: async () => {
      throw new Error("response lost after atomic database commit");
    },
  });

  assert.deepEqual(result, {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.equal(stored.length, 1);
  assert.deepEqual(removed, []);
});
