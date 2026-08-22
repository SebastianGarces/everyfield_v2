import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrivacyFeatureKey } from "@/lib/auth/access";
import { privacyColumnFor } from "@/lib/auth/access";
import { isSharingFeature, SHARING_PULL_TOGGLES } from "@/lib/sharing/toggles";

import { SHARING_TOGGLE_COLUMNS } from "@/lib/privacy/sharing-defaults";

import { OVERSIGHT_SHARING_FEATURE } from "./categories";

// ----------------------------------------------------------------------------
// The write's aim (CS-011).
//
// `setSharingToggle` writes a COMPUTED key — `{ [privacyColumnFor(feature)]:
// enabled }` — so "the column written is the column the read gate names" is not
// a property to test, it is the same expression twice. What is still worth
// asserting is the map underneath it: two features sharing one column would
// make one switch move another, and a feature with no column would be a switch
// that writes nowhere.
// ----------------------------------------------------------------------------

const EVERY_FEATURE: readonly PrivacyFeatureKey[] = [
  ...SHARING_PULL_TOGGLES.map((toggle) => toggle.feature),
  OVERSIGHT_SHARING_FEATURE,
];

test("no two features share a column", () => {
  // An injective map is what makes "writes its own column" mean "leaves the
  // other six alone" — the difference between closing Finances and closing
  // Finances while opening People.
  const columns = EVERY_FEATURE.map(privacyColumnFor);

  assert.equal(new Set(columns).size, columns.length);
  for (const column of columns) {
    assert.match(column, /^share/, `${column} is not a share_* column`);
  }
});

test("every feature the panel writes is a feature the action admits", () => {
  // The action's boundary check and the panel's row list are the same question
  // asked from two ends. `share_wiki` (#62) becomes writable only by gaining a
  // row in `SHARING_PULL_TOGGLES`, which is a build failure until it does.
  for (const feature of EVERY_FEATURE) {
    assert.ok(isSharingFeature(feature), feature);
  }
  assert.equal(isSharingFeature("everything"), false);
  assert.equal(isSharingFeature("share_people"), false);
  assert.equal(EVERY_FEATURE.length, 7);
});

test("every column CS-013 turns on has a switch in the panel", () => {
  // THE TWO ENDS OF ONE RULING, TIED (#620 + #619). CS-013's acceptance turns on
  // every boolean column the SCHEMA has, read at build time by
  // `SHARING_TOGGLE_COLUMNS` — deliberately not a list anybody typed. The panel
  // renders a row per FEATURE KEY, which is a list somebody typed.
  //
  // So a `share_*` column added without a feature key is invisible to the panel
  // and fully switched on by every invitation: a plant sharing something with no
  // way to see it, let alone close it. The compile-time guard in
  // `@/lib/sharing/toggles` cannot catch that one — it fires when
  // `PrivacyFeatureKey` widens, and this is the case where it does not.
  const covered = EVERY_FEATURE.map(privacyColumnFor).sort();

  assert.deepEqual(
    [...SHARING_TOGGLE_COLUMNS].sort(),
    covered,
    "a sharing column the acceptance turns on has no switch in the panel"
  );
});
