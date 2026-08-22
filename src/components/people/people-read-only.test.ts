import assert from "node:assert/strict";
import { test } from "node:test";

import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { QuickActions } from "@/components/dashboard/quick-actions";
import { ViewerCapabilitiesProvider } from "@/components/shared/viewer-capabilities";
import type { Capability } from "@/lib/auth/seat-rules";
import type { PersonForClient } from "@/lib/people/types";
import { namedButtons, parseElements } from "@/lib/testing/rendered-markup";

import { PeopleList } from "./people-list";
import { PersonHeader } from "./person-header";
import { SkillsList } from "./skills-list";
import { TagPicker } from "./tag-picker";

// ----------------------------------------------------------------------------
// THE PEOPLE SURFACES IN A READ-ONLY CONTEXT — AS-020 (#499), rows 2-4 of the
// FRD's read-only surface checklist.
//
// THE RULE UNDER TEST IS AN ABSENCE, which is why every assertion below reads
// RENDERED MARKUP rather than the source. AS-020 says a write affordance the
// viewer may not use is HIDDEN, not disabled — a disabled button is still in
// the DOM, still reads out to a screen reader, and still advertises a power
// somebody else has. A source scan for the word "Add Person" cannot tell a hide
// from a disable; a scan of the markup for the ANCHOR can.
//
// AND EVERY CASE IS RENDERED TWICE, held and not held. An over-hide is the same
// drift as an under-hide (recipe rule 2): a control the server would allow but
// the UI refuses to show is a feature nobody can reach. So each test asserts the
// control is absent for a plant Member AND present for somebody holding the
// verb, off the same component with the same props — the only difference being
// the capability list the provider carries.
//
// THE VERB IS NEVER DECIDED HERE. `capabilities` below is typed `Capability`,
// whose members come from `CAPABILITIES` in `@/lib/auth/seat-rules` — the same
// table `requireSeat` refuses the POST with. This file asserts the transport
// works, not what the rule should be.
//
// WHAT THIS FILE DOES NOT CLAIM. None of it is authorization. `requireSeat`
// refuses every one of these actions server-side whether or not its button ever
// rendered, and `seat-guard.test.ts` is what asserts that. A hidden control is a
// statement about what somebody is ASKED to do.
// ----------------------------------------------------------------------------

/** The plant Member: a seat in the plant, and none of the write verbs. */
const READ_ONLY: readonly Capability[] = [];

/** An Admin, as far as the people directory is concerned. */
const WRITER: readonly Capability[] = ["people.write"];

/**
 * A router that refuses every call. A STATIC render fires no handler, so
 * nothing here is ever reached — its job is to satisfy the `useRouter` mount
 * invariant these components hit at render time. Throwing rather than no-op'ing
 * means a render that DID navigate would say so instead of passing silently.
 */
const STUB_ROUTER = new Proxy({} as never, {
  get() {
    return () => {
      throw new Error("a static render must not navigate");
    };
  },
});

/** Render `element` as the viewer holding exactly `capabilities`. */
function renderAs(
  capabilities: readonly Capability[],
  element: ReactElement
): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: STUB_ROUTER },
      createElement(ViewerCapabilitiesProvider, {
        capabilities,
        children: element,
      })
    )
  );
}

/** Every `href` in the markup — the create affordances here are mostly links. */
function hrefs(html: string): string[] {
  return parseElements(html)
    .map((el) => el.attrs["href"])
    .filter((href): href is string => href !== undefined);
}

/**
 * The assertion every case in this file shares.
 *
 * `disabled` is checked on BOTH renders, not only the read-only one: the
 * failure this issue exists to remove is a control that stays in the markup
 * greyed out, and it would pass a bare "the label is gone" check if the label
 * moved into an aria attribute.
 */
function assertHidden(
  hiddenHtml: string,
  shownHtml: string,
  needle: string | RegExp,
  what: string
) {
  const pattern = typeof needle === "string" ? new RegExp(needle) : needle;

  assert.doesNotMatch(
    hiddenHtml,
    pattern,
    `AS-020: ${what} must be ABSENT from a read-only viewer's markup, not disabled`
  );
  assert.match(
    shownHtml,
    pattern,
    `${what} must still render for somebody holding the verb — hiding it from them would be stricter than the server`
  );
  assert.doesNotMatch(
    hiddenHtml,
    /<button[^>]*\bdisabled\b/,
    `${what}: a disabled button still announces a control the viewer may not use`
  );
}

// ----------------------------------------------------------------------------
// Row 2 — the dashboard's quick-action tiles
// ----------------------------------------------------------------------------

test("the dashboard's create tiles are absent for a viewer holding neither verb", () => {
  const asMember = renderToStaticMarkup(
    createElement(QuickActions, { capabilities: [] })
  );
  const asAdmin = renderToStaticMarkup(
    createElement(QuickActions, {
      capabilities: ["people.write", "meetings.write"],
    })
  );

  assertHidden(asMember, asAdmin, "/people/new", "the Add Person tile");
  assertHidden(asMember, asAdmin, "/meetings/new", "the Schedule Meeting tile");

  // AND THE TWO READS SURVIVE. `/tasks` and the pipeline are the same screens
  // every seat already reaches, so hiding them would be the over-hide.
  for (const read of ["/tasks", "/people?view=pipeline"]) {
    assert.ok(
      hrefs(asMember).includes(read),
      `${read} is a read — every context holds it, so the tile stays`
    );
  }
});

test("one verb held shows one create tile, not both and not neither", () => {
  const html = renderToStaticMarkup(
    createElement(QuickActions, { capabilities: ["people.write"] })
  );

  assert.deepEqual(
    hrefs(html),
    ["/people/new", "/tasks", "/people?view=pipeline"],
    "the tiles are gated one verb at a time — holding people.write must not also unlock the meeting"
  );
});

// ----------------------------------------------------------------------------
// Row 3 — the people directory's empty state
// ----------------------------------------------------------------------------

const EMPTY_LIST = { people: [], total: 0, nextCursor: null };

test("the people empty state offers no create CTA to a read-only viewer", () => {
  const asMember = renderAs(READ_ONLY, createElement(PeopleList, EMPTY_LIST));
  const asAdmin = renderAs(WRITER, createElement(PeopleList, EMPTY_LIST));

  assertHidden(
    asMember,
    asAdmin,
    "/people/new",
    "the empty state's Add Person call to action"
  );

  // RULE 4 — THE EMPTY STATE EXPLAINS RATHER THAN INVITES. Losing the button
  // must not leave a viewer told to do a thing they cannot do, so the copy
  // changes with it and names who does add people.
  assert.doesNotMatch(
    asMember,
    /add a new person/,
    "the read-only copy must not ask for an action the viewer cannot take"
  );
  assert.match(
    asMember,
    /admins add people to the directory/,
    "the read-only copy states who adds people instead of inviting the reader to"
  );
  assert.ok(
    asMember.includes("No people found"),
    "the FACT is not what is hidden — the viewer still learns the list is empty"
  );
});

// ----------------------------------------------------------------------------
// Row 4 — the person header, and the overview cards under it
// ----------------------------------------------------------------------------

const PERSON: PersonForClient = {
  id: "00000000-0000-4000-8000-000000000001",
  churchId: "00000000-0000-4000-8000-0000000000c1",
  firstName: "Mel",
  lastName: "Okafor",
  email: "mel@plant.test",
  phone: null,
  status: "core_group",
  source: "vision_meeting",
  sourceDetails: null,
  notes: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: "US",
  backgroundCheckStatus: "not_started",
  photoSrc: undefined,
  householdId: null,
  householdRole: null,
  pipelineSortOrder: 0,
  createdBy: "00000000-0000-4000-8000-0000000000a1",
  createdAt: new Date("2026-02-03T00:00:00.000Z"),
  updatedAt: new Date("2026-02-03T00:00:00.000Z"),
  deletedAt: null,
};

const noop = () => {};

function personHeader(capabilities: readonly Capability[]): string {
  return renderAs(
    capabilities,
    createElement(PersonHeader, {
      person: PERSON,
      household: null,
      onEdit: noop,
      onDelete: noop,
    })
  );
}

test("the person header offers no edit, delete or change-status control", () => {
  const asMember = personHeader(READ_ONLY);
  const asAdmin = personHeader(WRITER);

  assertHidden(asMember, asAdmin, ">Edit<", "the Edit button");

  // THE OVERFLOW MENU GOES WITH IT, trigger included. Its items live in a Radix
  // portal that a closed menu never renders, so the TRIGGER is what a markup
  // scan can see — and a trigger with nothing behind it is the "empty column"
  // failure `seat-roster.test.ts` names: a control announcing a set of actions
  // that is not there.
  assertHidden(asMember, asAdmin, "More actions", "the overflow menu trigger");

  assert.deepEqual(
    parseElements(asMember).filter((el) => el.tag === "button"),
    [],
    "AS-020: a read-only viewer's person header carries no button at all"
  );
});

test("the person header still reads in full for a read-only viewer", () => {
  // The absence is of the CONTROLS, not of the information. A Member opened
  // this person's page to read it.
  const html = personHeader(READ_ONLY);

  for (const shown of ["Mel", "Okafor", "Core Group", "Joined on"]) {
    assert.ok(
      html.includes(shown),
      `the identity block is a read and stays — "${shown}" must still render`
    );
  }
});

test("the skills card hides add, edit and remove but keeps the inventory", () => {
  const skills = [
    {
      id: "00000000-0000-4000-8000-0000000000s1",
      churchId: PERSON.churchId,
      personId: PERSON.id,
      skillName: "Sound engineering",
      skillCategory: "tech" as const,
      proficiency: "advanced" as const,
      notes: null,
      createdAt: new Date("2026-02-03T00:00:00.000Z"),
      updatedAt: new Date("2026-02-03T00:00:00.000Z"),
    },
  ];
  const props = { personId: PERSON.id, skills };

  const asMember = renderAs(READ_ONLY, createElement(SkillsList, props));
  const asAdmin = renderAs(WRITER, createElement(SkillsList, props));

  assertHidden(asMember, asAdmin, ">Add Skill<", "the Add Skill button");

  // EVERY ROW CONTROL CARRIES AN `aria-label`, so `namedButtons` is both the
  // reader and the accessibility check — a control that loses its label leaves
  // this set and the assertion fails rather than passing over one element
  // fewer.
  assert.deepEqual(
    namedButtons(asMember).map((button) => button.attrs["aria-label"]),
    [],
    "AS-020: the per-skill edit and remove controls are not rendered"
  );
  assert.deepEqual(
    namedButtons(asAdmin)
      .map((button) => button.attrs["aria-label"])
      .sort(),
    ["Edit Sound engineering", "Remove Sound engineering"],
    "both row controls come back for somebody holding people.write"
  );

  assert.ok(
    asMember.includes("Sound engineering"),
    "the skill itself is a read — it is the CONTROLS that are absent"
  );
});

test("a tag badge loses its remove control, not its label", () => {
  // THE EASY ONE TO MISS. Removing a tag is a `people.write` action reached
  // through the small × inside the badge, not through a button in the picker —
  // so the badge is handed no `onRemove` at all and renders as a plain label.
  const tags = [
    {
      id: "00000000-0000-4000-8000-0000000000t1",
      churchId: PERSON.churchId,
      name: "Worship",
      color: "blue",
      createdAt: new Date("2026-02-03T00:00:00.000Z"),
    },
  ];
  const props = {
    personId: PERSON.id,
    selectedTags: tags,
    availableTags: tags,
  };

  const asMember = renderAs(READ_ONLY, createElement(TagPicker, props));
  const asAdmin = renderAs(WRITER, createElement(TagPicker, props));

  assertHidden(asMember, asAdmin, "Remove Worship tag", "the tag remove ×");
  assertHidden(asMember, asAdmin, "Add Tag", "the Add Tag trigger");

  assert.ok(
    asMember.includes("Worship"),
    "the tag itself is a read and stays on the person"
  );
});
