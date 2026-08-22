import assert from "node:assert/strict";
import { test } from "node:test";

import { meetingTypes } from "@/db/schema/meetings";
import { TS_FILES, codeOf, rel } from "@/lib/auth/server-action-surface";
import {
  emailableGuests,
  meetingComposeUrl,
} from "@/lib/communication/meeting-compose";
import {
  SYSTEM_TEMPLATES,
  meetingInvitationTemplate,
} from "@/lib/communication/system-templates";

// ----------------------------------------------------------------------------
// #612 — Meeting → Send Email
//
// The bug this file is written against had no failure in it. Compose mapped
// `team_meeting` to a template named "Team Meeting Invitation", the seed
// catalog had never contained one, the lookup matched nothing and returned
// null, and the planter got an empty subject and an empty body with no way to
// tell that a template had been meant.
//
// HALF OF THAT IS NOW UNREPRESENTABLE. The relation lives on the catalog entry
// (`SystemTemplate.invitesMeetingType`), so there is no name in one file that
// can point at a row in another and miss. What a test still has to hold is the
// direction a field cannot: a meeting type that NO template claims, which is
// the shape `team_meeting` was in.
// ----------------------------------------------------------------------------

// ============================================================================
// Every meeting type has an invitation
// ============================================================================

test("every meeting type is invited by exactly one seeded template", () => {
  // A NAME can point at nothing; a field on the catalog entry cannot, which is
  // why the relation moved onto `SystemTemplate.invitesMeetingType`. What is
  // left to check is the other direction — a meeting type nothing claims. That
  // is the #612 bug exactly: `team_meeting` was mapped by compose and owned by
  // no template, so it opened blank and reported nothing.
  for (const type of meetingTypes) {
    const claiming = SYSTEM_TEMPLATES.filter(
      (template) => template.invitesMeetingType === type
    );

    assert.equal(
      claiming.length,
      1,
      `${type} is invited by ${claiming.length} seeded templates (${claiming
        .map((t) => t.name)
        .join(
          ", "
        )}) — set invitesMeetingType on exactly one entry in system-templates.ts`
    );
    // The lookup filters on the category too, so an entry seeded under any
    // other category is as invisible as a missing one.
    assert.equal(
      claiming[0].category,
      "meeting_invitation",
      `"${claiming[0].name}" is seeded as ${claiming[0].category}; meetingInvitationTemplate only looks at meeting_invitation`
    );
  }
});

test("no template claims a meeting type the schema does not have", () => {
  const claimed = SYSTEM_TEMPLATES.map((t) => t.invitesMeetingType).filter(
    (type): type is (typeof meetingTypes)[number] => type !== undefined
  );

  for (const type of claimed) {
    assert.ok(
      meetingTypes.includes(type),
      `a template claims "${type}", which is not a meeting type`
    );
  }
});

test("a seeded invitation is found by the lookup", () => {
  // The whole path: the rows a church would see, looked up the way the compose
  // page looks them up.
  const asRows = SYSTEM_TEMPLATES.map((t) => ({
    name: t.name,
    category: t.category,
  }));

  for (const type of meetingTypes) {
    const found = meetingInvitationTemplate(type, asRows);
    const expected = SYSTEM_TEMPLATES.find(
      (t) => t.invitesMeetingType === type
    );
    assert.equal(found?.name, expected?.name, type);
  }
});

// ============================================================================
// The lookup
// ============================================================================

test("a church's renamed fork wins over the system original", () => {
  // Editing a system template forks it (`templates.ts`, copy-on-write) and
  // `getTemplates` returns the fork in the original's place — usually under a
  // name the church has changed around the original.
  const found = meetingInvitationTemplate("team_meeting", [
    {
      name: "Our Team Meeting Invitation (2026)",
      category: "meeting_invitation",
    },
  ]);

  assert.equal(found?.name, "Our Team Meeting Invitation (2026)");
});

test("a template in another category is not an invitation", () => {
  const found = meetingInvitationTemplate("team_meeting", [
    { name: "Team Meeting Invitation", category: "announcement" },
  ]);

  assert.equal(found, null);
});

test("an unrecognised meeting type suggests nothing", () => {
  // The type arrives off a row that may predate the current enum.
  assert.equal(meetingInvitationTemplate("prayer_walk", []), null);
});

test("a prototype member is not a meeting type", () => {
  // The lookup scans the catalog rather than indexing a map, so a forged key
  // cannot reach `Object.prototype` and hand `name` a native FUNCTION — the bug
  // `meetingTypeLabel`'s `Object.hasOwn` gate exists for. Pinned here because
  // the scan is what makes it true, and a scan is one refactor from a `Record`.
  for (const key of ["constructor", "toString", "__proto__"]) {
    assert.equal(
      meetingInvitationTemplate(key, [
        { name: "Team Meeting Invitation", category: "meeting_invitation" },
      ]),
      null,
      key
    );
  }
});

// ============================================================================
// Who gets the email
// ============================================================================

test("a guest with no email address is not a recipient", () => {
  const guests = [
    { personId: "p1", email: "a@example.com" },
    { personId: "p2", email: null },
    { personId: "p3", email: "" },
    { personId: "p4", email: "d@example.com" },
  ];

  assert.deepEqual(
    emailableGuests(guests).map((g) => g.personId),
    ["p1", "p4"]
  );
  assert.equal(
    meetingComposeUrl("m1", guests),
    "/communication/compose?meetingId=m1&recipientIds=p1%2Cp4"
  );
});

test("the compose URL carries the meeting even with nobody to write to", () => {
  // `recipientIds` is omitted rather than sent empty: the compose page parses
  // an empty value into an empty list anyway, and a parameter that says nothing
  // is one more thing for a reader to wonder about.
  assert.equal(
    meetingComposeUrl("m1", [{ personId: "p1", email: null }]),
    "/communication/compose?meetingId=m1"
  );
  // `guests` has no default — a Send Email control with nobody to write to
  // passes `[]` and says so, rather than silently omitting the argument and
  // reopening #612 through a call the walk below cannot see.
  assert.equal(
    meetingComposeUrl("m1", []),
    "/communication/compose?meetingId=m1"
  );
});

test("ids are encoded, not interpolated", () => {
  // The ids are uuids in practice, and the builder does not rely on it.
  assert.equal(
    meetingComposeUrl("a b&c", [{ personId: "x y", email: "x@example.com" }]),
    "/communication/compose?meetingId=a+b%26c&recipientIds=x+y"
  );
});

// ============================================================================
// No second builder
// ============================================================================

test("nothing builds a meeting compose URL by hand", () => {
  // The equality tests above can only pin the builder that exists. This pins
  // that no new copy appears: the whole bug was two hand-written spellings of
  // one URL on one page, and the one that omitted `recipientIds` was the one a
  // planter reached first.
  const offenders = TS_FILES.filter((file) => {
    const relative = rel(file);
    if (relative === "src/lib/communication/meeting-compose.ts") return false;
    if (relative.endsWith(".test.ts")) return false;
    // `codeOf` strips comments and KEEPS string literals, which is what makes
    // this a test about links rather than about prose.
    return codeOf(file).includes("/communication/compose?meetingId=");
  }).map(rel);

  assert.deepEqual(
    offenders,
    [],
    `these build a meeting compose URL by hand — call meetingComposeUrl instead: ${offenders.join(", ")}`
  );
});
