import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHURCH_TEXT_MAX,
  churchBasicsFromFormData,
  churchBasicsSchema,
} from "./onboarding";

// ----------------------------------------------------------------------------
// F12 / OB-001 + OB-002 — step 1's contract.
//
// Two things matter here and both are easy to get wrong. First, the name is the
// ONLY required field: a planter who has not settled on a city must still be
// able to create their church. Second, an untouched optional field must reach
// the database as NULL, not "". An empty string would mean "the planter told us
// their city is blank", and every reader downstream — settings, merge fields,
// any future region rollup — would have to handle two spellings of absent.
// ----------------------------------------------------------------------------

function formData(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

test("name alone is enough to create a church", () => {
  const parsed = churchBasicsSchema.safeParse({
    name: "Grace Community Church",
    city: "",
    stateRegion: "",
    country: "",
  });

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data, {
    name: "Grace Community Church",
    city: null,
    stateRegion: null,
    country: null,
  });
});

test("each location part is independently optional", () => {
  // A planter with a region but no city, and a planter with a city but no
  // country, are both perfectly normal.
  const regionOnly = churchBasicsSchema.safeParse({
    name: "Hill Country Church",
    city: "",
    stateRegion: "Texas",
    country: "",
  });
  assert.equal(regionOnly.success, true);
  assert.deepEqual(
    { city: regionOnly.data?.city, region: regionOnly.data?.stateRegion },
    { city: null, region: "Texas" }
  );

  const cityOnly = churchBasicsSchema.safeParse({
    name: "Hill Country Church",
    city: "Austin",
    stateRegion: "",
    country: "",
  });
  assert.equal(cityOnly.success, true);
  assert.equal(cityOnly.data?.city, "Austin");
  assert.equal(cityOnly.data?.country, null);
});

test("whitespace-only input is absent, not present-and-blank", () => {
  const parsed = churchBasicsSchema.safeParse({
    name: "  Grace Community Church  ",
    city: "   ",
    stateRegion: "\t\n",
    country: " ",
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.name, "Grace Community Church");
  assert.equal(parsed.data?.city, null);
  assert.equal(parsed.data?.stateRegion, null);
  assert.equal(parsed.data?.country, null);
});

test("a name of only whitespace is a missing name", () => {
  const parsed = churchBasicsSchema.safeParse({
    name: "     ",
    city: "",
    stateRegion: "",
    country: "",
  });

  assert.equal(parsed.success, false);
  assert.match(parsed.error!.issues[0].message, /enter a name/i);
});

test("the name is capped at the column width", () => {
  const atLimit = churchBasicsSchema.safeParse({
    name: "a".repeat(CHURCH_TEXT_MAX),
    city: "",
    stateRegion: "",
    country: "",
  });
  assert.equal(atLimit.success, true);

  const overLimit = churchBasicsSchema.safeParse({
    name: "a".repeat(CHURCH_TEXT_MAX + 1),
    city: "",
    stateRegion: "",
    country: "",
  });
  assert.equal(overLimit.success, false);
  assert.match(overLimit.error!.issues[0].message, /255 characters or less/);
});

test("an over-long location part is rejected rather than truncated", () => {
  // Truncating would silently store a city the planter never typed; the column
  // is varchar(255) and the insert would fail anyway.
  const parsed = churchBasicsSchema.safeParse({
    name: "Grace Community Church",
    city: "a".repeat(CHURCH_TEXT_MAX + 1),
    stateRegion: "",
    country: "",
  });

  assert.equal(parsed.success, false);
  assert.equal(parsed.error!.issues[0].path[0], "city");
});

test("trailing whitespace does not push a name over the limit", () => {
  const parsed = churchBasicsSchema.safeParse({
    name: `${"a".repeat(CHURCH_TEXT_MAX)}     `,
    city: "",
    stateRegion: "",
    country: "",
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.name.length, CHURCH_TEXT_MAX);
});

// ----------------------------------------------------------------------------
// FormData reading.
// ----------------------------------------------------------------------------

test("a missing optional key reads the same as an empty one", () => {
  const parsed = churchBasicsFromFormData(
    formData({ name: "Grace Community Church" })
  );

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data, {
    name: "Grace Community Church",
    city: null,
    stateRegion: null,
    country: null,
  });
});

test("form data carries every field through", () => {
  const parsed = churchBasicsFromFormData(
    formData({
      name: "Grace Community Church",
      city: "Austin",
      stateRegion: "Texas",
      country: "United States",
    })
  );

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data, {
    name: "Grace Community Church",
    city: "Austin",
    stateRegion: "Texas",
    country: "United States",
  });
});

test("a missing name fails instead of creating an unnamed church", () => {
  const parsed = churchBasicsFromFormData(formData({ city: "Austin" }));

  assert.equal(parsed.success, false);
  assert.equal(parsed.error!.issues[0].path[0], "name");
});
