import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contextualTemplateHref,
  getLaunchChecklistSection,
  getMeetingContextualTemplates,
  getTeamContextualTemplates,
} from "./contextual";
import { getTemplateById } from "./templates";

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
  const templates = getMeetingContextualTemplates("vision_meeting");

  assert.deepEqual(
    templates.map((t) => t.id),
    ["vision-meeting-agenda", "guest-sign-in-sheet", "response-card"]
  );
});

test("vision meeting links carry the template's catalog metadata", () => {
  const templates = getMeetingContextualTemplates("vision_meeting");

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
  assert.deepEqual(getMeetingContextualTemplates("orientation"), []);
  assert.deepEqual(getMeetingContextualTemplates("team_meeting"), []);
});

test("an unrecognized meeting type offers nothing rather than throwing", () => {
  assert.deepEqual(getMeetingContextualTemplates("not_a_meeting_type"), []);
  assert.deepEqual(getMeetingContextualTemplates(""), []);
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
// No dead links, anywhere
// ----------------------------------------------------------------------------

test("every contextual template resolves to a real catalog template", () => {
  const all = [
    ...getMeetingContextualTemplates("vision_meeting"),
    ...getTeamContextualTemplates({ name: "Facilities" }),
  ];

  assert.ok(all.length > 0);
  for (const contextual of all) {
    assert.ok(
      getTemplateById(contextual.id),
      `${contextual.id} must resolve via getTemplateById`
    );
    assert.ok(contextual.formats.length > 0);
  }
});
