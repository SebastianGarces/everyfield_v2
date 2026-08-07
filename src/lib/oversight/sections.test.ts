import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EMPTY_HEADLINE,
  OVERSIGHT_SECTIONS,
  OVERSIGHT_SECTIONS_BY_KEY,
  WITHHELD_HEADLINE,
  emptyExplanation,
  sectionsIntro,
  withheldExplanation,
} from "./sections";

// ----------------------------------------------------------------------------
// Every section declares the toggle that gates it (OV-002)
//
// The read layer resolves `privacyFeature` through `canAccessFeatureData`, so a
// section without one would render ungated feature data to an oversight user —
// the exact thing the six `share_*` columns exist to prevent.
// ----------------------------------------------------------------------------

const PULL_TOGGLES = new Set([
  "people",
  "meetings",
  "tasks",
  "financials",
  "ministry_teams",
  "facilities",
]);

test("every section is gated by one of the six pull toggles", () => {
  assert.ok(OVERSIGHT_SECTIONS.length > 0);
  for (const section of OVERSIGHT_SECTIONS) {
    assert.ok(
      PULL_TOGGLES.has(section.privacyFeature),
      `${section.key} names "${section.privacyFeature}", which is not a share_* pull toggle`
    );
  }
});

test("no section is gated by the PUSH toggle", () => {
  // `oversight_activity` gates what is PUSHED to an oversight recipient
  // (notifications, N-026). Using it to gate a dashboard READ would silently
  // change what the plant's consent copy means (memory/invariants.md).
  for (const section of OVERSIGHT_SECTIONS) {
    assert.notEqual(section.privacyFeature, "oversight_activity");
  }
});

test("section keys are unique and the lookup is total over them", () => {
  const keys = OVERSIGHT_SECTIONS.map((section) => section.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate section key");
  for (const key of keys) {
    assert.equal(OVERSIGHT_SECTIONS_BY_KEY[key].key, key);
  }
});

// ----------------------------------------------------------------------------
// Explain-why copy (OV-002): "never a bare blank"
// ----------------------------------------------------------------------------

test("the withheld state says why it is hidden AND who controls that", () => {
  for (const section of OVERSIGHT_SECTIONS) {
    const copy = withheldExplanation(section, "Hope City Church", "network");
    assert.match(copy, /Hope City Church/, "names the plant");
    assert.match(copy, /your network/, "names who it was withheld from");
    assert.match(
      copy,
      /Each plant decides what it shares/,
      "says who controls sharing"
    );
    // It must not promise a screen the planter does not have: the per-feature
    // pull toggles have no UI yet (board #187).
    assert.doesNotMatch(copy, /settings|Settings/);
  }
});

test("shared-but-empty is a different sentence from withheld", () => {
  const section = OVERSIGHT_SECTIONS[0];
  const withheld = withheldExplanation(section, "Hope City Church", "network");
  const empty = emptyExplanation(section, "Hope City Church");

  assert.notEqual(withheld, empty);
  assert.notEqual(WITHHELD_HEADLINE, EMPTY_HEADLINE);
  // The distinction that matters to the reader: sharing IS on here.
  assert.match(empty, /shares/);
  assert.match(empty, /not recorded anything/);
});

test("no empty state is blank", () => {
  for (const section of OVERSIGHT_SECTIONS) {
    for (const copy of [
      withheldExplanation(section, "Hope City Church", "sending church"),
      emptyExplanation(section, "Hope City Church"),
    ]) {
      assert.ok(copy.trim().length > 40, `too terse to explain: "${copy}"`);
    }
  }
});

// ----------------------------------------------------------------------------
// The intro describes the gate; it never asserts sharing that did not happen
// ----------------------------------------------------------------------------

test("the intro does not claim openness when every section is withheld", () => {
  const closed = sectionsIntro("Invitation Flow Church", "network", 0);
  // The bug this replaced: an unconditional "each area below is open to your
  // network" above four cards that all read "Not shared".
  assert.ok(!/is open to your|are open to your/.test(closed), closed);
  assert.match(closed, /has not opened any of these areas to your network/);
  assert.match(closed, /each plant decides what it shares/);
});

test("the intro names the gate rather than promising the contents", () => {
  const open = sectionsIntro("Hope City Church", "sending church", 2);
  assert.match(
    open,
    /decides which of these areas are open to your sending church/
  );
  // Both forms carry the aggregates-only promise, which is the one claim that
  // is true whatever the toggles say.
  for (const copy of [open, sectionsIntro("Hope City Church", "network", 0)]) {
    assert.match(copy, /Totals only — never the people behind them\./);
  }
});
