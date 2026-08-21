import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { namedButtons } from "@/lib/testing/rendered-markup";
import { sourceReader, stripComments } from "@/lib/testing/source-span";

import type { SeatActionOutcome } from "./seat-action-outcome";
import {
  SeatRoster,
  type SeatRosterActions,
  type SeatRosterViewRow,
} from "./seat-roster";

// ----------------------------------------------------------------------------
// THE SEAT ROSTER'S MARKUP — AS-015 / AS-017 / AS-020 / AS-023 (#497).
//
// THE RULE UNDER TEST IS AN ABSENCE, and that is why it is asserted on rendered
// markup rather than on the source. AS-020 says a write affordance a context may
// not use is HIDDEN, not disabled: a `disabled` button is still in the markup,
// still reads out to a screen reader, and still tells an Admin that a control
// exists which somebody else may press. A source scan for the word "Remove"
// cannot tell those two apart; a rendered-markup scan for the BUTTON can.
//
// EVERY CONTROL CARRIES AN `aria-label`, so `namedButtons` is both the reader
// and the accessibility check — a control that loses its label leaves the set
// and the count assertions below fail rather than quietly passing over one
// element fewer.
//
// WHAT THIS FILE DELIBERATELY DOES NOT CLAIM. None of this is authorization.
// `requireSeat("seat.manage")` and the plant-scoped `WHERE` in
// `@/lib/seats/roster` refuse a POST that never rendered this component, and
// `seat-removal-live.test.ts` is what asserts that. A hidden control is a
// statement about what somebody is ASKED to do.
//
// The component takes its actions as PROPS (the `InvitationsList` pattern), so
// nothing here touches a database and the stubs below never run — a static
// render fires no handler.
// ----------------------------------------------------------------------------

const OWNER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";

const refuse = async (): Promise<SeatActionOutcome> => ({
  success: false,
  error: "stub",
});

const STUB_ACTIONS: SeatRosterActions = {
  appoint: refuse,
  demote: refuse,
  remove: refuse,
};

/**
 * The fixture tenancy AS-023 is read over: one Owner, one Admin, one Member.
 *
 * `isSelf` is the PAGE's answer (`row.userId === session.user.id`), so it is a
 * parameter here — the same roster is rendered twice below, once as the Owner
 * reading it and once as the Admin.
 */
function roster(selfId: string): SeatRosterViewRow[] {
  return [
    {
      userId: OWNER,
      name: "Paula Planter",
      email: "paula@plant.test",
      seat: "owner",
      joinedLabel: "Jan 4, 2026",
      isSelf: selfId === OWNER,
    },
    {
      userId: ADMIN,
      name: "Aaron Admin",
      email: "aaron@plant.test",
      seat: "admin",
      joinedLabel: "Feb 11, 2026",
      isSelf: selfId === ADMIN,
    },
    {
      userId: MEMBER,
      name: null,
      email: "mel@plant.test",
      seat: "member",
      joinedLabel: "Mar 2, 2026",
      isSelf: selfId === MEMBER,
    },
  ];
}

function render(selfId: string, canManageSeats: boolean): string {
  return renderToStaticMarkup(
    createElement(SeatRoster, {
      rows: roster(selfId),
      canManageSeats,
      actions: STUB_ACTIONS,
    })
  );
}

const asOwner = () => render(OWNER, true);
const asAdmin = () => render(ADMIN, false);

/** Every control's accessible name, which is what identifies the verb. */
function controlLabels(html: string): string[] {
  return namedButtons(html).map((button) => button.attrs["aria-label"]);
}

// ----------------------------------------------------------------------------
// AS-023 — the roster reads in one pass
// ----------------------------------------------------------------------------

test("the roster shows each person's name, address, seat and join date", () => {
  const html = asOwner();

  for (const shown of [
    "Paula Planter",
    "paula@plant.test",
    "Owner",
    "Jan 4, 2026",
    "Aaron Admin",
    "aaron@plant.test",
    "Admin",
    "Feb 11, 2026",
    "mel@plant.test",
    "Member",
    "Mar 2, 2026",
  ]) {
    assert.ok(
      html.includes(shown),
      `AS-023: the roster must show "${shown}" — an Owner auditing access reads all four columns in one pass`
    );
  }
});

test("an account with no name shows a placeholder, never a blank cell", () => {
  // `users.name` is nullable and an invited person may never set one. The
  // ADDRESS is what identifies them either way, so the row stays legible and
  // its controls stay addressable (see the aria-label assertion below).
  assert.ok(
    asOwner().includes("Not set"),
    "a nameless account must still read as a row, not as an empty cell"
  );
});

// ----------------------------------------------------------------------------
// AS-015 — the Owner's controls
// ----------------------------------------------------------------------------

test("the Owner is offered appoint, demote and remove on the right rows", () => {
  const labels = controlLabels(asOwner());

  assert.deepEqual(
    labels.sort(),
    [
      "Make a Member — Aaron Admin",
      "Make an Admin — mel@plant.test",
      "Remove Aaron Admin from this plant",
      "Remove mel@plant.test from this plant",
    ].sort(),
    "the Member is offered promotion, the Admin demotion, and both removal — and the Owner's own row offers nothing"
  );
});

test("a nameless person is addressed by their email, not by an empty name", () => {
  // The control's accessible name is the ONLY thing distinguishing two rows'
  // buttons to a screen reader, so a null name must fall back rather than
  // render "Remove  from this plant".
  assert.ok(
    controlLabels(asOwner()).includes("Remove mel@plant.test from this plant"),
    "a row with no name must name the person by their address in every control"
  );
});

// ----------------------------------------------------------------------------
// AS-017 — an Owner may not remove themselves
// ----------------------------------------------------------------------------

test("the Owner's own row carries no control at all", () => {
  const labels = controlLabels(asOwner());

  assert.equal(
    labels.some((label) => label.includes("Paula Planter")),
    false,
    "AS-017: an Owner sees no control to remove themselves, and no control to move their own seat"
  );

  // AND IT IS AN ABSENCE, NOT A DISABLED BUTTON. The Owner's name appears in
  // the roster; what must not appear is a button naming it.
  assert.ok(
    asOwner().includes("Paula Planter"),
    "the Owner is still ON the roster — it is the CONTROL that is absent"
  );
});

// ----------------------------------------------------------------------------
// AS-015 / AS-020 — an Admin sees no seat control, absent rather than disabled
// ----------------------------------------------------------------------------

test("an Admin sees no appoint, demote or remove control in the markup", () => {
  const html = asAdmin();

  assert.deepEqual(
    controlLabels(html),
    [],
    "AS-015: appoint, demote and remove are not rendered for an Admin"
  );

  // THE THREE SPELLINGS A "HIDDEN" CONTROL IS USUALLY GOT WRONG AS. A disabled
  // button, a control with the verb still in its text, and the column header
  // that would announce a set of controls with nothing under it.
  assert.doesNotMatch(
    html,
    /<button[^>]*\bdisabled\b/,
    "AS-020: hidden means absent from the markup — a disabled button still announces the control"
  );
  assert.doesNotMatch(
    html,
    /Make an Admin|Make a Member|Remove/,
    "no seat verb may appear in an Admin's markup, as a button or as anything else"
  );
  assert.doesNotMatch(
    html,
    /Manage/,
    "the actions column header goes with the actions — an empty column announces a set of controls that is not there"
  );
});

test("an Admin still reads the whole roster", () => {
  // The absence is of the CONTROLS, not of the information. AS-014 gives an
  // Admin this page and AS-023's roster is what they came to read.
  const html = asAdmin();

  for (const shown of ["Paula Planter", "Aaron Admin", "mel@plant.test"]) {
    assert.ok(
      html.includes(shown),
      `an Admin must still see ${shown} on the roster`
    );
  }
});

// ----------------------------------------------------------------------------
// The two gates are independent — #555, pinning a #544 review fix
// ----------------------------------------------------------------------------

// WHY THIS ONE IS SOURCE-SHAPED AND THE REST ARE NOT.
//
// `manageable` used to gate BOTH controls on `rule.removable`, so a seat
// declared movable-but-not-removable would silently lose its appoint control —
// with no diff anywhere near the line that decided it. #544's review caught it
// and it was fixed; nothing pinned the fix.
//
// It cannot be pinned by rendering, and that is the point: the coupling is
// invisible for exactly as long as no seat has `move !== null` with
// `removable: false`. All three seats today are movable-and-removable or
// neither, so a render test passes identically on the broken version. The
// property is real but only observable in the source until a fourth seat
// exists — so the source is what this reads, through `sourceReader`, whose
// anchors throw when they move instead of silently widening the span.
//
// Comments are stripped first. The prose above names `removable` several
// times, and a scan that fed on its own documentation would be green without
// being true.

const COMPONENT = sourceReader(
  stripComments(
    readFileSync(
      path.join(process.cwd(), "src/components/settings/seat-roster.tsx"),
      "utf8"
    )
  ),
  "src/components/settings/seat-roster.tsx"
);

test("the appoint/demote control does not read `removable`", () => {
  const moveControl = COMPONENT.span(
    "{mayAct && move ?",
    "{mayAct && rule.removable ?"
  );

  assert.doesNotMatch(
    moveControl,
    /removable/,
    "whether a seat may MOVE is `move`, and whether it may be REMOVED is `removable` — gating the move button on the removal rule is how a movable-but-not-removable seat silently loses its appoint control"
  );
});

test("each control gates on its own rule, and both on `mayAct`", () => {
  assert.match(
    COMPONENT.code,
    /\{mayAct && move \?/,
    "the move control gates on `mayAct` and the seat's own `move` rule"
  );
  assert.match(
    COMPONENT.code,
    /\{mayAct && rule\.removable \?/,
    "the remove control gates on `mayAct` and the seat's own `removable` rule"
  );
});

test("the shared gate is exactly the two clauses it is allowed to be", () => {
  // THE PROPERTY, NOT THE SPELLING — and this is the assertion that does the
  // work. The test above pins the two JSX conditions, and both stay green if
  // the coupling moves UP into `mayAct`. Two spellings do that, and a scan
  // written against either one lets the other through:
  //
  //   const mayAct = canManageSeats && !row.isSelf && rule.removable;
  //   const manageable = canManageSeats && !row.isSelf && rule.removable;
  //   const mayAct = manageable;
  //
  // So this pins the declaration POSITIVELY rather than listing forbidden
  // words. `mayAct` answers WHO may act — an Admin manages nothing (AS-015),
  // nobody manages their own row (AS-017) — and neither clause is about which
  // seat the row holds. Anything else in it re-couples the two controls no
  // matter how the JSX below is written.
  //
  // `after` and not `span`: `span` resolves BOTH anchors as the first match in
  // the whole file, so a `";"` end-anchor lands on an import statement. The
  // declaration is one statement, so its own terminator ends it.
  const rest = COMPONENT.after("const mayAct =");
  const declaration = rest.slice(0, rest.indexOf(";") + 1);

  assert.equal(
    declaration,
    "const mayAct = canManageSeats && !row.isSelf;",
    "`mayAct` is the shared half and nothing else. Reading a per-seat rule here — directly, or through a boolean that read one — is the coupling #544's review removed; give each control its own gate in the JSX instead"
  );
});
