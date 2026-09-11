import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { withEvryPeopleLiveProofStorage } from "@/lib/evry/capabilities/people/file-storage";

import { createEvryPeopleEffectProofStorage } from "./evry-people-effect-live-proof-storage";

const priorLiveDbTests = process.env.LIVE_DB_TESTS;

afterEach(() => {
  if (priorLiveDbTests === undefined) delete process.env.LIVE_DB_TESTS;
  else process.env.LIVE_DB_TESTS = priorLiveDbTests;
});

test("the in-memory People storage scope refuses non-live processes", () => {
  delete process.env.LIVE_DB_TESTS;
  assert.throws(
    () =>
      withEvryPeopleLiveProofStorage(
        createEvryPeopleEffectProofStorage(),
        async () => undefined
      ),
    /requires LIVE_DB_TESTS=1/
  );
});
