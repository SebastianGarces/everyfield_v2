import assert from "node:assert/strict";
import { test } from "node:test";

import { markPlantDirty, plantDirtyColumns } from "./dirty-handler";

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

// ----------------------------------------------------------------------------
// F12 / OB-009. Onboarding completion stamps the dirty columns in the SAME
// statement that sets `onboarding_completed_at`, so the two facts cannot
// disagree. That only works if "dirty" has one definition — these pin the
// shared one, including the shared clock, since a caller that passed its own
// timestamp for one column and `new Date()` for the other would write a row
// whose `updated_at` precedes its own event.
// ----------------------------------------------------------------------------

test("plantDirtyColumns stamps last_material_event_at and updated_at together", () => {
  const now = new Date("2026-08-05T12:00:00Z");

  assert.deepEqual(plantDirtyColumns(now), {
    lastMaterialEventAt: now,
    updatedAt: now,
  });
});

test("plantDirtyColumns defaults to one clock read, not two", () => {
  const columns = plantDirtyColumns();

  assert.equal(
    columns.lastMaterialEventAt.getTime(),
    columns.updatedAt.getTime()
  );
});
