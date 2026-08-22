import assert from "node:assert/strict";
import { test } from "node:test";

import { meetingTypes } from "@/db/schema/meetings";
import { TS_FILES, codeOf, rel } from "@/lib/auth/server-action-surface";
import {
  MEETING_INVITATION_TEMPLATE_NAMES,
  emailableGuests,
  meetingComposeUrl,
  meetingInvitationTemplate,
} from "@/lib/communication/meeting-compose";
import { SYSTEM_TEMPLATES } from "@/lib/communication/system-templates";

// ----------------------------------------------------------------------------
// #612 — Meeting → Send Email
//
// The bug this file is written against had no failure in it. Compose mapped
// `team_meeting` to a template named "Team Meeting Invitation", the seed
// catalog had never contained one, the lookup matched nothing and returned
// null, and the planter got an empty subject and an empty body with no way to
// tell that a template had been meant. A name pointing at nothing is exactly
// the kind of mistake a `Record<MeetingType, string>` cannot catch: the KEYS
// are the compiler's, the VALUES are strings.
// ----------------------------------------------------------------------------

// ============================================================================
// The invitation map names templates that exist
// ============================================================================

test("every meeting type invites with a template the catalog seeds", () => {
  const seeded = new Map(SYSTEM_TEMPLATES.map((t) => [t.name, t]));

  for (const type of meetingTypes) {
    const name = MEETING_INVITATION_TEMPLATE_NAMES[type];
    const template = seeded.get(name);

    assert.ok(
      template,
      `${type} invites with "${name}", which no entry in SYSTEM_TEMPLATES seeds — ` +
        `add it to system-templates.ts or point the map at a template that exists`
    );
    // The lookup filters on the category as well as the name, so a template
    // seeded under any other category is as invisible as a missing one.
    assert.equal(
      template.category,
      "meeting_invitation",
      `"${name}" is seeded as ${template.category}; meetingInvitationTemplate only looks at meeting_invitation`
    );
  }
});

test("the map covers the enum and nothing else", () => {
  // `Record<MeetingType, string>` already makes a missing key a compile error.
  // This is the runtime half: a type added to the schema and forgotten here
  // fails the suite rather than opening compose blank.
  assert.deepEqual(
    Object.keys(MEETING_INVITATION_TEMPLATE_NAMES).sort(),
    [...meetingTypes].sort()
  );
});

test("a seeded invitation is found by the lookup that names it", () => {
  // The two halves above are about the catalog. This is the whole path: the
  // rows a church would see, looked up the way compose looks them up.
  const asRows = SYSTEM_TEMPLATES.map((t) => ({
    name: t.name,
    category: t.category,
  }));

  for (const type of meetingTypes) {
    const found = meetingInvitationTemplate(type, asRows);
    assert.equal(found?.name, MEETING_INVITATION_TEMPLATE_NAMES[type], type);
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
  // A bare index would reach `Object.prototype` and hand `name` a native
  // FUNCTION, which `.includes` on a template name would then be compared
  // against. Same gate and same reason as `meetingTypeLabel`.
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
  assert.equal(meetingComposeUrl("m1"), "/communication/compose?meetingId=m1");
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
