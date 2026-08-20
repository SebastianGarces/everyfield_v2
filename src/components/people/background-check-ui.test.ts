import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  assertInOrder,
  sourceReader,
  stripComments,
} from "@/lib/testing/source-span";

// ----------------------------------------------------------------------------
// WHERE THE BACKGROUND CHECK IS EDITED, AND WHERE IT IS SHOWN.
//
// Three claims live in JSX that this process cannot render — the components are
// `"use client"` and there is no DOM here — so they are asserted over SOURCE,
// through `sourceReader`, whose anchors THROW when they move
// (`memory/invariants.md` → Multi-Tenancy, the source-span rule). What is
// pinned is the wiring a re-layout would silently drop: the control's form
// field name, the value each surface reads, and the gate the roster stands
// behind. Nothing here pins a class name or a word of copy.
// ----------------------------------------------------------------------------

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), ...relative.split("/")), "utf8");
}

const FORM_PATH = "src/components/people/person-form.tsx";
const OVERVIEW_PATH = "src/components/people/person-overview.tsx";
const HEADER_PATH = "src/components/people/person-header.tsx";
const ROSTER_PATH = "src/components/ministry-teams/members-roles-tab.tsx";
const BADGE_PATH = "src/components/people/background-check-badge.tsx";

// ----------------------------------------------------------------------------
// The profile EDITS it.
// ----------------------------------------------------------------------------

test("the person form posts the status under the name the schema parses", () => {
  const form = sourceReader(stripComments(read(FORM_PATH)), FORM_PATH);

  // The field name IS the contract with `personUpdateSchema`: the form posts
  // FormData, so a renamed control is a silently ignored edit, not an error.
  assertInOrder(
    form.code,
    FORM_PATH,
    [
      'name="backgroundCheckStatus"',
      'defaultValue={person?.backgroundCheckStatus ?? "not_started"}',
      "backgroundCheckStatuses.map(",
    ],
    "the control names the field, seeds from the row, and offers every status"
  );
});

test("editing a person may still change the check, unlike status", () => {
  const form = sourceReader(stripComments(read(FORM_PATH)), FORM_PATH);
  const action = form.span(
    "const action = async (",
    "const [state, formAction"
  );

  // Edit mode strips `status` so it can only move through the Change Status
  // modal. The background check has no second surface, so it must NOT be
  // stripped with it — that would make the control inert on the one screen
  // that matters.
  assert.match(action, /formData\.delete\("status"\)/);
  assert.doesNotMatch(action, /backgroundCheckStatus/);
});

// ----------------------------------------------------------------------------
// The profile SHOWS it.
// ----------------------------------------------------------------------------

test("the overview shows the stored value, floor included", () => {
  const overview = stripComments(read(OVERVIEW_PATH));

  assert.match(
    overview,
    /<BackgroundCheckBadge\s+status=\{person\.backgroundCheckStatus\}/
  );
  // No gate: the labelled field says "Not started" rather than disappearing.
  assert.doesNotMatch(overview, /not_started/);
});

test("the header carries the badge only once the check has left the floor", () => {
  const header = sourceReader(stripComments(read(HEADER_PATH)), HEADER_PATH);

  assertInOrder(
    header.code,
    HEADER_PATH,
    [
      'person.backgroundCheckStatus !== "not_started"',
      "{showsBackgroundCheck && (",
      "<BackgroundCheckBadge",
    ],
    "a badge beside every name in the plant saying 'not started' is noise"
  );
});

// ----------------------------------------------------------------------------
// The ROSTER shows it, for the teams that require it.
// ----------------------------------------------------------------------------

test("the roster asks whether the team requires a check, once, by team", () => {
  const roster = sourceReader(stripComments(read(ROSTER_PATH)), ROSTER_PATH);

  assertInOrder(
    roster.code,
    ROSTER_PATH,
    [
      "const showsBackgroundChecks = teamRequiresBackgroundCheck(team.templateKey)",
      "{showsBackgroundChecks && (",
      "status={role.assignedPerson.backgroundCheckStatus}",
    ],
    "one predicate decides, keyed on the TEMPLATE (#378) — so a role-level flag later reaches this surface too"
  );

  // The roster never re-derives which teams require a check.
  assert.doesNotMatch(roster.code, /childrens_ministry|Children's Ministry/);
});

test("the roster reads the status off the row the service projected", () => {
  const teams = sourceReader(
    stripComments(read("src/lib/ministry-teams/teams.ts")),
    "teams.ts"
  );
  const getTeam = teams.span(
    "export async function getTeam(",
    "export async function createTeam("
  );

  assert.match(
    getTeam,
    /backgroundCheckStatus: persons\.backgroundCheckStatus/
  );
});

// ----------------------------------------------------------------------------
// One badge, so the two surfaces cannot drift.
// ----------------------------------------------------------------------------

test("only the badge component paints a background-check tint", () => {
  const badge = read(BADGE_PATH);
  assert.match(badge, /backgroundCheckBadge\(status\)/);

  for (const surface of [OVERVIEW_PATH, HEADER_PATH, ROSTER_PATH]) {
    assert.doesNotMatch(
      stripComments(read(surface)),
      /BACKGROUND_CHECK_BADGE_CONFIG/,
      `${surface} must render <BackgroundCheckBadge>, not its own copy of the tint`
    );
  }
});
