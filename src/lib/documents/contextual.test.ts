import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contextualTemplateHref,
  getLaunchChecklistSection,
  getMeetingContextualTemplates,
  getTeamContextualTemplates,
} from "./contextual";
import { LAUNCH_CHECKLIST_SECTION_NAMES } from "./pdf/launch-sunday-checklists";
import { getTemplateById } from "./templates";

/** The meeting section's templates, or `[]` when the type offers none. */
function meetingTemplates(meetingType: string) {
  return getMeetingContextualTemplates(meetingType)?.templates ?? [];
}

// ----------------------------------------------------------------------------
// Links (DOC-014) — every contextual link opens the template's generate dialog
// on the documents library, never a direct download URL.
// ----------------------------------------------------------------------------

test("contextualTemplateHref points at the library with the template pre-opened", () => {
  assert.equal(
    contextualTemplateHref("response-card"),
    "/documents?template=response-card"
  );
});

test("contextualTemplateHref never links straight at the generate API", () => {
  assert.ok(!contextualTemplateHref("response-card").startsWith("/api/"));
});

test("contextualTemplateHref encodes the template id", () => {
  assert.equal(
    contextualTemplateHref("a b&c"),
    "/documents?template=a%20b%26c"
  );
});

// ----------------------------------------------------------------------------
// Meetings
// ----------------------------------------------------------------------------

test("a vision meeting offers its agenda, sign-in sheet, and response card", () => {
  assert.deepEqual(
    meetingTemplates("vision_meeting").map((t) => t.id),
    ["vision-meeting-agenda", "guest-sign-in-sheet", "response-card"]
  );
});

test("the meeting section carries its own heading", () => {
  assert.equal(
    getMeetingContextualTemplates("vision_meeting")?.title,
    "Vision Meeting Documents"
  );
});

test("vision meeting links carry the template's catalog metadata", () => {
  const templates = meetingTemplates("vision_meeting");

  for (const contextual of templates) {
    const template = getTemplateById(contextual.id);
    assert.ok(template, `${contextual.id} must exist in the catalog`);
    assert.equal(contextual.name, template.name);
    assert.equal(contextual.description, template.description);
    assert.deepEqual(contextual.formats, template.formats);
    assert.equal(contextual.href, `/documents?template=${template.id}`);
  }
});

test("meeting types with no matching template offer nothing", () => {
  // `null`, not an empty section — the page renders no heading at all.
  assert.equal(getMeetingContextualTemplates("orientation"), null);
  assert.equal(getMeetingContextualTemplates("team_meeting"), null);
});

test("an unrecognized meeting type offers nothing rather than throwing", () => {
  assert.equal(getMeetingContextualTemplates("not_a_meeting_type"), null);
  assert.equal(getMeetingContextualTemplates(""), null);
});

// ----------------------------------------------------------------------------
// Ministry teams
// ----------------------------------------------------------------------------

test("a ministry team offers the Launch Sunday checklist packet", () => {
  const templates = getTeamContextualTemplates({ name: "Worship Team" });

  assert.deepEqual(
    templates.map((t) => t.id),
    ["launch-sunday-checklists"]
  );
  assert.equal(
    templates[0].href,
    "/documents?template=launch-sunday-checklists"
  );
});

test("the team's own launch-day section is named on the link", () => {
  const [worship] = getTeamContextualTemplates({ name: "Worship Team" });
  assert.equal(worship.note, "Includes the Worship & Production checklist.");

  const [kids] = getTeamContextualTemplates({ name: "Children's Ministry" });
  assert.equal(kids.note, "Includes the Children's Ministry checklist.");
});

test("a team with no dedicated section still gets the packet, without a note", () => {
  const [smallGroups] = getTeamContextualTemplates({ name: "Small Groups" });

  assert.equal(smallGroups.id, "launch-sunday-checklists");
  assert.equal(smallGroups.note, undefined);
});

test("getLaunchChecklistSection maps predefined teams to packet sections", () => {
  assert.equal(getLaunchChecklistSection("Facilities"), "Setup & Teardown");
  assert.equal(getLaunchChecklistSection("Prayer"), "Prayer");
  assert.equal(
    getLaunchChecklistSection("Assimilation"),
    "Connections & Follow-up"
  );
  assert.equal(getLaunchChecklistSection("Senior Pastor"), null);
});

test("getLaunchChecklistSection matches regardless of case or custom naming", () => {
  assert.equal(
    getLaunchChecklistSection("kids ministry crew"),
    "Children's Ministry"
  );
  assert.equal(
    getLaunchChecklistSection("HOSPITALITY"),
    "Hospitality & Welcome"
  );
});

// ----------------------------------------------------------------------------
// The UI must never promise a checklist the packet does not print
// ----------------------------------------------------------------------------

test("every section the UI can name is a section the PDF actually prints", () => {
  // Names are also constrained at compile time (LaunchChecklistSection), but a
  // rename in the PDF must fail loudly here too rather than leave the team page
  // advertising a checklist that no longer exists.
  const teamNames = [
    "Facilities",
    "Setup Crew",
    "Hospitality",
    "Greeters",
    "Ushers",
    "Welcome Team",
    "Worship",
    "Production",
    "Music",
    "Technology",
    "Audio",
    "Children's Ministry",
    "Kids",
    "Nursery",
    "Assimilation",
    "Connections",
    "Follow-up",
    "Prayer",
  ];

  for (const teamName of teamNames) {
    const section = getLaunchChecklistSection(teamName);
    assert.ok(section, `${teamName} should map to a section`);
    assert.ok(
      LAUNCH_CHECKLIST_SECTION_NAMES.includes(section),
      `"${section}" (from "${teamName}") is not printed by the packet — ` +
        `the PDF prints: ${LAUNCH_CHECKLIST_SECTION_NAMES.join(", ")}`
    );
  }
});

test("every section the packet prints is reachable from some team name", () => {
  // Guards the other direction: a section added to the PDF without a keyword
  // here is a checklist no team page will ever point at.
  const reachable = new Set(
    [
      "Facilities",
      "Hospitality",
      "Worship",
      "Children's Ministry",
      "Assimilation",
      "Prayer",
    ].map((name) => getLaunchChecklistSection(name))
  );

  for (const section of LAUNCH_CHECKLIST_SECTION_NAMES) {
    assert.ok(
      reachable.has(section),
      `no team name maps to the "${section}" checklist`
    );
  }
});

// ----------------------------------------------------------------------------
// No dead links, anywhere
// ----------------------------------------------------------------------------

const ALL_CONTEXTUAL = [
  ...meetingTemplates("vision_meeting"),
  ...getTeamContextualTemplates({ name: "Facilities" }),
];

test("every contextual template resolves to a real catalog template", () => {
  assert.ok(ALL_CONTEXTUAL.length > 0);
  for (const contextual of ALL_CONTEXTUAL) {
    assert.ok(
      getTemplateById(contextual.id),
      `${contextual.id} must resolve via getTemplateById`
    );
    assert.ok(contextual.formats.length > 0);
  }
});

test("no contextual link is a blind download — every one opens the library", () => {
  for (const contextual of ALL_CONTEXTUAL) {
    assert.ok(
      contextual.href.startsWith("/documents?template="),
      `${contextual.id} must open the library, got ${contextual.href}`
    );
    assert.ok(!contextual.href.includes("format="));
  }
});
