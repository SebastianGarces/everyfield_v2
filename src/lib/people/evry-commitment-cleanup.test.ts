import assert from "node:assert/strict";
import { test } from "node:test";

import { sweepEvryCommitmentDocumentObjects } from "./evry-milestones";
import { EVRY_FINAL_OBJECT_GRACE_MS } from "./person-photo";

const PLANT_ID = "10000000-0000-4000-8000-000000000001";
const PERSON_ID = "20000000-0000-4000-8000-000000000001";
const PREFIX = `commitments/${PLANT_ID}/${PERSON_ID}/`;
const NOW = new Date("2026-08-29T12:00:00.000Z");

test("commitment cleanup preserves every referenced final and retries orphan deletion", async () => {
  const referenced = `${PREFIX}referenced.pdf`;
  const orphan = `${PREFIX}orphan.pdf`;
  const foreign = `commitments/30000000-0000-4000-8000-000000000001/${PERSON_ID}/foreign.pdf`;
  let fail = true;
  const removed: string[] = [];
  const old = new Date(NOW.getTime() - EVRY_FINAL_OBJECT_GRACE_MS - 1);
  const sweep = () =>
    sweepEvryCommitmentDocumentObjects({
      plantId: PLANT_ID,
      personId: PERSON_ID,
      loadReferenced: async () => [referenced],
      now: NOW,
      list: async () =>
        [referenced, orphan, foreign].map((key) => ({
          key,
          lastModified: old,
        })),
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
  assert.deepEqual(removed, [orphan]);
});

test("commitment cleanup rechecks references after listing and protects young objects", async () => {
  const becameReferenced = `${PREFIX}became-referenced.pdf`;
  const young = `${PREFIX}young.pdf`;
  let listed = false;
  const removed: string[] = [];
  const result = await sweepEvryCommitmentDocumentObjects({
    plantId: PLANT_ID,
    personId: PERSON_ID,
    now: NOW,
    list: async () => {
      listed = true;
      return [
        {
          key: becameReferenced,
          lastModified: new Date(
            NOW.getTime() - EVRY_FINAL_OBJECT_GRACE_MS - 1
          ),
        },
        { key: young, lastModified: NOW },
      ];
    },
    loadReferenced: async () => {
      assert.equal(listed, true);
      return [becameReferenced];
    },
    remove: async (key) => void removed.push(key),
  });
  assert.deepEqual(result, { removed: 0, failed: 0 });
  assert.deepEqual(removed, []);
});
