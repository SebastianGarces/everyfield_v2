import assert from "node:assert/strict";
import { test } from "node:test";

import { markPlantDirty } from "./dirty-handler";

// ----------------------------------------------------------------------------
// Dirty-handler guard (PE-010). markPlantDirty short-circuits before any DB
// access when given an empty churchId, so this path is DB-free and safe to run
// without a connection. The happy path (real UPDATE) is exercised by the
// subscription wiring test + integration, not here.
// ----------------------------------------------------------------------------

test("markPlantDirty no-ops on empty churchId without touching the DB", async () => {
  // Must resolve (not throw, not hang) even with no DB available.
  await assert.doesNotReject(() => markPlantDirty(""));
});
