import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { resetEvryPeopleEffectProofDirtyMarker } from "./evry-people-effect-live-proof-seed";

const priorLiveDbTests = process.env.LIVE_DB_TESTS;

afterEach(() => {
  if (priorLiveDbTests === undefined) delete process.env.LIVE_DB_TESTS;
  else process.env.LIVE_DB_TESTS = priorLiveDbTests;
});

test("the People effect proof seed refuses every non-live invocation", async () => {
  delete process.env.LIVE_DB_TESTS;
  await assert.rejects(
    resetEvryPeopleEffectProofDirtyMarker(
      "11111111-1111-4111-8111-111111111111"
    ),
    /requires LIVE_DB_TESTS=1/
  );
});
