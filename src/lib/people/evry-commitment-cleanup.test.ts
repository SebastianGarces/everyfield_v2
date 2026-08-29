import assert from "node:assert/strict";
import { test } from "node:test";

import { sweepEvryCommitmentDocumentObjects } from "./evry-milestones";

const PLANT_ID = "10000000-0000-4000-8000-000000000001";
const PERSON_ID = "20000000-0000-4000-8000-000000000001";
const PREFIX = `commitments/${PLANT_ID}/${PERSON_ID}/`;

test("commitment cleanup preserves every referenced final and retries orphan deletion", async () => {
  const referenced = `${PREFIX}referenced.pdf`;
  const orphan = `${PREFIX}orphan.pdf`;
  const foreign = `commitments/30000000-0000-4000-8000-000000000001/${PERSON_ID}/foreign.pdf`;
  let fail = true;
  const removed: string[] = [];
  const sweep = () =>
    sweepEvryCommitmentDocumentObjects({
      plantId: PLANT_ID,
      personId: PERSON_ID,
      loadReferenced: async () => [referenced],
      list: async () => [referenced, orphan, foreign],
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
