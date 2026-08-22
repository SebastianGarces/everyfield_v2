import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { CHURCH_TEXT_MAX } from "@/lib/validations/onboarding";

import {
  CHURCH_PROFILE_FIELDS,
  churchProfileFieldIds,
  churchProfileWriteSchema,
  INACTIVITY_DAYS_MAX,
  INACTIVITY_DAYS_MIN,
  INACTIVITY_ORDER_MESSAGE,
  inactivityThresholdsSchema,
} from "./profile";

const SRC = path.join(process.cwd(), "src");

// ============================================================================
// The church profile's parsers, and the one rule the parsers cannot state:
// that nothing ELSE in the product writes these columns (#618, CS-006/009/015).
// ============================================================================

// ----------------------------------------------------------------------------
// The registry
// ----------------------------------------------------------------------------

test("every field the write schema accepts is a field the registry draws", () => {
  // Two lists that must not drift: the array the section maps over and the
  // union the action parses. A field in one and not the other is either an
  // input nothing can save or an endpoint nothing offers.
  const parsable = churchProfileFieldIds.filter(
    (id) =>
      churchProfileWriteSchema.safeParse({ field: id, value: "Dayspring" })
        .success
  );

  assert.deepEqual(parsable, [...churchProfileFieldIds]);
});

test("only the name is required, and every field carries its own copy", () => {
  const required = CHURCH_PROFILE_FIELDS.filter((field) => field.required);
  assert.deepEqual(
    required.map((field) => field.id),
    ["name"],
    "the name column is the only NOT NULL one of the five"
  );

  for (const field of CHURCH_PROFILE_FIELDS) {
    assert.ok(field.label.length > 0, field.id);
    assert.ok(field.placeholder.length > 0, field.id);
    assert.ok(field.autoComplete.length > 0, field.id);
    // Sentence case (DESIGN.md → voice): the first word is capitalised and no
    // later word is, unless it is a proper noun — which none of these are.
    assert.equal(
      field.label,
      field.label[0].toUpperCase() + field.label.slice(1).toLowerCase(),
      `${field.id}'s label is not sentence case`
    );
  }
});

// ----------------------------------------------------------------------------
// The write schema (CS-006 / CS-015)
// ----------------------------------------------------------------------------

test("an optional field left blank parses to NULL, never to an empty string", () => {
  // OB-002's contract, restated at the settings boundary: ONE flavour of
  // absent. `""` in the column would read as "the planter said their city is
  // blank" and every later surface would have to know about both.
  for (const id of ["streetAddress", "city", "stateRegion", "country"]) {
    const parsed = churchProfileWriteSchema.parse({ field: id, value: "   " });
    assert.equal(parsed.value, null, id);
  }
});

test("a blank NAME is refused, and the refusal names the field", () => {
  // CS-015: a failed save names the field, not the form. The sentence is the
  // parser's, which is why the control has nothing to compose for itself.
  const result = churchProfileWriteSchema.safeParse({
    field: "name",
    value: "   ",
  });

  assert.equal(result.success, false);
  assert.equal(
    result.error?.issues[0].message,
    "Enter a name for your church plant."
  );
});

test("every value is trimmed before it reaches the column", () => {
  // better-accessibility → forms: autocomplete and text expansion add trailing
  // spaces, so trim at the boundary rather than storing what was pasted.
  const parsed = churchProfileWriteSchema.parse({
    field: "name",
    value: "  Dayspring Church  ",
  });
  assert.equal(parsed.value, "Dayspring Church");
});

test("a value past the column width is refused with a positive instruction", () => {
  const result = churchProfileWriteSchema.safeParse({
    field: "city",
    value: "x".repeat(CHURCH_TEXT_MAX + 1),
  });

  assert.equal(result.success, false);
  assert.match(result.error?.issues[0].message ?? "", /Use 255 characters/);

  // Exactly at the width is FINE. A guard that refused 255 would be the same
  // bug inverted, and the column would silently hold less than it declares.
  assert.equal(
    churchProfileWriteSchema.safeParse({
      field: "city",
      value: "x".repeat(CHURCH_TEXT_MAX),
    }).success,
    true
  );
});

test("a field the union has no arm for is refused outright", () => {
  // The endpoint is POSTable with no UI. `launchDate` is the one to try: CS-014
  // says Launch Sunday appears nowhere on this page, and `launches` has been
  // its only owner since migration 0032 dropped `churches.launch_date`.
  for (const field of ["launchDate", "currentPhase", "sendingChurchId", ""]) {
    assert.equal(
      churchProfileWriteSchema.safeParse({ field, value: "x" }).success,
      false,
      field
    );
  }
});

// ----------------------------------------------------------------------------
// Inactivity thresholds (CS-009)
// ----------------------------------------------------------------------------

test("warning must be strictly below alert, and the issue is carried on the warning", () => {
  for (const pair of [
    { warningDays: 14, alertDays: 14 },
    { warningDays: 30, alertDays: 14 },
  ]) {
    const result = inactivityThresholdsSchema.safeParse(pair);
    assert.equal(result.success, false, JSON.stringify(pair));
    assert.equal(result.error?.issues[0].message, INACTIVITY_ORDER_MESSAGE);
    // CS-015 again: the refusal lands ON a field, so the control renders it
    // under an input rather than over the card.
    assert.deepEqual(result.error?.issues[0].path, ["warningDays"]);
  }
});

test("both ends of the day range are accepted and neither is exceeded", () => {
  assert.equal(
    inactivityThresholdsSchema.safeParse({
      warningDays: INACTIVITY_DAYS_MIN,
      alertDays: INACTIVITY_DAYS_MAX,
    }).success,
    true
  );

  for (const pair of [
    { warningDays: INACTIVITY_DAYS_MIN - 1, alertDays: 14 },
    { warningDays: 7, alertDays: INACTIVITY_DAYS_MAX + 1 },
    { warningDays: 7.5, alertDays: 14 },
    { warningDays: "7", alertDays: 14 },
  ]) {
    assert.equal(
      inactivityThresholdsSchema.safeParse(pair).success,
      false,
      JSON.stringify(pair)
    );
  }
});

test("the refusal for a bad day count names WHICH count", () => {
  const result = inactivityThresholdsSchema.safeParse({
    warningDays: 7,
    alertDays: 900,
  });

  assert.equal(result.success, false);
  assert.match(result.error?.issues[0].message ?? "", /alert day count/);
});

// ----------------------------------------------------------------------------
// Who may edit the profile (CS-006 — Admin and above)
// ----------------------------------------------------------------------------

test("a plant Member cannot edit the profile; an Admin and an Owner can", () => {
  const PLANT = "22222222-2222-4222-8222-222222222222";
  const plant = (seat: "owner" | "admin" | "member" | null) => ({
    churchId: PLANT,
    sendingChurchId: null,
    sendingNetworkId: null,
    seat,
  });

  assert.equal(holdsSeatFor(plant("owner"), "church.profile"), true);
  assert.equal(holdsSeatFor(plant("admin"), "church.profile"), true);
  // AC: "a Member sees no church profile, and the write action refuses a Member
  // server-side". Both halves are this one predicate — `sections.ts` gates the
  // section on it and `requireSeat("church.profile")` throws on it — so they
  // cannot disagree.
  assert.equal(holdsSeatFor(plant("member"), "church.profile"), false);
  // A coach holds no seat and names no plant.
  assert.equal(holdsSeatFor(plant(null), "church.profile"), false);
  // An oversight Owner is refused by TENANCY, not by seat: `church.profile` is
  // `tenancy: "plant"`, so a sending church's Owner cannot rename a plant.
  assert.equal(
    holdsSeatFor(
      {
        churchId: null,
        sendingChurchId: "33333333-3333-4333-8333-333333333333",
        sendingNetworkId: null,
        seat: "owner",
      },
      "church.profile"
    ),
    false
  );
});

// ----------------------------------------------------------------------------
// NO SECOND WRITER (the AC's "grep confirms no other name writer", as a walk)
// ----------------------------------------------------------------------------

/**
 * Every file under `src/` that runs an UPDATE against `churches`.
 *
 * A checked-in list rather than a grep run by hand, because the property the AC
 * asks for — "the edited name renders wherever the church is named, with no
 * second edit surface" — rests on there being exactly ONE update path that may
 * name a profile column. The oversight plants directory and the per-plant page
 * both read `churches.name` live (`buildPlantSummaries`), so a rename shows up
 * there for free; what would break that is a SECOND writer keeping a copy.
 *
 * Adding a file here is deliberate. Adding one that writes `name`, `city`,
 * `state_region`, `country` or `street_address` outside `churches/settings.ts`
 * needs a ruling first — it is a second church-profile edit surface.
 */
const CHURCH_UPDATERS = [
  "src/app/(dashboard)/dashboard/confirm-leadership.ts",
  "src/lib/churches/settings.ts",
  "src/lib/invitations/core.ts",
  "src/lib/onboarding/complete-onboarding.ts",
  "src/lib/phase-engine/dirty-handler.ts",
  "src/lib/phase-engine/signals/attestation-service.ts",
  "src/lib/phase-engine/transitions/service.ts",
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.includes(".test.")
    ) {
      found.push(full);
    }
  }
  return found;
}

test("only the declared modules update `churches`, and only one writes the profile", () => {
  const updaters = sourceFiles(SRC)
    .filter((file) =>
      /\.update\(\s*churches\s*\)/.test(readFileSync(file, "utf8"))
    )
    .map((file) => path.relative(process.cwd(), file))
    .sort();

  assert.deepEqual(
    updaters,
    CHURCH_UPDATERS,
    "a module started updating `churches` — see this list's docblock"
  );

  // ALL FIVE PROFILE COLUMNS, and `name` above all — it is the column the
  // ruling is about, and scanning for a bare /\bname\b/ over whole file text
  // would hit every unrelated `name:` property in the repo. So the scan is of
  // the `.set({…})` OBJECT of each `.update(churches)` chain, which is the only
  // place a column can actually be written.
  const PROFILE_COLUMNS = /\b(name|city|country|streetAddress|stateRegion)\s*:/;

  const namingProfileColumns = updaters.filter((file) => {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const setBlocks = source.matchAll(
      /\.update\(\s*churches\s*\)[\s\S]{0,80}?\.set\(([\s\S]*?)\)\s*\.where/g
    );
    return [...setBlocks].some((match) => PROFILE_COLUMNS.test(match[1]));
  });

  // `settings.ts` writes them through `profilePatch`, spread into the `.set()`,
  // so its own `.set()` object does not name a column literally — which is why
  // it is absent here rather than the sole entry. That is the point: NOTHING
  // names a profile column inside an `.update(churches).set()` anywhere.
  assert.deepEqual(
    namingProfileColumns,
    [],
    "a module writes a church-profile column outside `churches/settings.ts` — that is a second church-profile edit surface and needs a ruling"
  );

  // And the guard has teeth: the same scan over a synthetic writer finds it.
  const planted = `db.update(churches).set({ name: input.name }).where(eq(churches.id, id))`;
  assert.equal(
    [
      ...planted.matchAll(
        /\.update\(\s*churches\s*\)[\s\S]{0,80}?\.set\(([\s\S]*?)\)\s*\.where/g
      ),
    ].some((match) => PROFILE_COLUMNS.test(match[1])),
    true,
    "the scan cannot see a second name writer, so it proves nothing"
  );
});

test("no church-settings component reads or writes Launch Sunday (CS-014)", () => {
  // "No control on the page reads or writes Launch Sunday." The launch entity
  // owns the date and its edits; the Church section links to `/launch` through
  // nothing at all, and the sharing teaser is its only outbound link.
  //
  // SCOPED TO THE CHURCH SECTION'S OWN FILES, not to `components/settings`
  // whole. The Association section names a launch date in a sentence about what
  // a sending church would see if you accepted their invitation — prose about
  // consent, not a control on this page, and CS-014 is about this page.
  const sectionFiles = sourceFiles(
    path.join(SRC, "components/settings")
  ).filter((file) => path.basename(file).startsWith("church-"));

  assert.ok(
    sectionFiles.length >= 5,
    "the Church section's files stopped matching `church-*` and this walk went blind"
  );

  for (const file of sectionFiles) {
    const source = readFileSync(file, "utf8")
      // Comments explain the ABSENCE, which is the whole point of CS-014 — so
      // strip them before looking, exactly as `cursor-pointer.test.ts` does.
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/^\s*\/\/.*$/gm, "");

    assert.doesNotMatch(
      source,
      /launch/i,
      `${path.relative(process.cwd(), file)} names launch`
    );
  }
});
