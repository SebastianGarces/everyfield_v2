import assert from "node:assert/strict";
import { test } from "node:test";

import { sweepEvryPersonPhotoObjects } from "./person-photo";

const PLANT_ID = "10000000-0000-4000-8000-000000000001";
const PERSON_ID = "20000000-0000-4000-8000-000000000001";
const PREFIX = `people/${PLANT_ID}/${PERSON_ID}/`;

test("photo cleanup preserves the current object and retries failed orphan deletes", async () => {
  const current = `${PREFIX}current.jpg`;
  const orphan = `${PREFIX}orphan.jpg`;
  const foreign = `people/30000000-0000-4000-8000-000000000001/${PERSON_ID}/foreign.jpg`;
  let fail = true;
  const removed: string[] = [];
  const storage = {
    store: async () => undefined,
    list: async () => [current, orphan, foreign],
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
      load: async () => ({ photoKey: current }),
    });

  assert.deepEqual(await sweep(), { removed: 0, failed: 1 });
  assert.deepEqual(await sweep(), { removed: 1, failed: 0 });
  assert.deepEqual(removed, [orphan]);
});
