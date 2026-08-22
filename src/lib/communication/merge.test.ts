import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMeetingMergeData,
  formatAgendaForEmail,
  renderEmailBodyHtml,
  renderEmailBodyText,
  renderSubject,
} from "@/lib/communication/merge";
import { MEETING_INVITATION_TEMPLATE_NAMES } from "@/lib/communication/meeting-compose";
import { SYSTEM_TEMPLATES } from "@/lib/communication/system-templates";
import { toRichTextHtml } from "@/lib/rich-text/format";

// ----------------------------------------------------------------------------
// #612 — `{{meeting_agenda}}`
//
// The agenda has always been on the meeting (`church_meetings.agenda`) and has
// never been able to reach an email: the meeting merge group carried title,
// type, date, location and the RSVP buttons and nothing else. These tests cover
// the field itself and the two properties that make it usable in a template a
// planter did not write conditionals for — an empty agenda leaves no heading
// and no gap.
// ----------------------------------------------------------------------------

const MEETING = {
  title: "Worship Team Sync",
  type: "team_meeting",
  datetime: new Date("2026-09-08T23:00:00.000Z"),
  locationName: "Room 2",
  locationAddress: null,
};

// ============================================================================
// The agenda, formatted
// ============================================================================

test("the agenda renders as a list under its own heading", () => {
  const value = formatAgendaForEmail([
    { id: "1", title: "Welcome", minutes: 10 },
    { id: "2", title: "Set list", minutes: 25 },
  ]);

  assert.equal(value, "Agenda:\n• Welcome (10 min)\n• Set list (25 min)");
});

test("a section with no timing prints its title alone", () => {
  // 0 is what `clampAgendaMinutes` returns for a timing it cannot read, so
  // "(0 min)" would print a parse failure to a guest as if it were the plan.
  assert.equal(
    formatAgendaForEmail([{ id: "1", title: "Open floor", minutes: 0 }]),
    "Agenda:\n• Open floor"
  );
});

test("no agenda renders nothing at all — not even the heading", () => {
  assert.equal(formatAgendaForEmail([]), "");
});

test("an unreadable agenda column sends an email without an agenda", () => {
  // `parseAgenda` is total, so none of these throws on the way to a send.
  for (const agenda of [null, undefined, "", "[]", 7, {}, [null], [{}]]) {
    assert.equal(
      buildMeetingMergeData({ ...MEETING, agenda }).meeting_agenda,
      "",
      JSON.stringify(agenda) ?? "undefined"
    );
  }
});

test("the meeting merge group carries the agenda beside the date", () => {
  const data = buildMeetingMergeData({
    ...MEETING,
    agenda: [{ id: "1", title: "Welcome", minutes: 10 }],
  });

  assert.equal(data.meeting_agenda, "Agenda:\n• Welcome (10 min)");
  assert.equal(data.meeting_title, "Worship Team Sync");
  assert.equal(data.meeting_type, "Team Meeting");
  // Zone-pinned through `@/lib/datetime`, so this is the same string the email
  // and the on-page preview both show.
  assert.match(data.meeting_date, /September 8, 2026/);
});

// ============================================================================
// Rendering a body
// ============================================================================

test("merge values reach the HTML body as text, never as markup", () => {
  const html = renderEmailBodyHtml("<p>Hi {{first_name}}</p>", {
    first_name: "Bobby <script>alert(1)</script>",
  });

  assert.ok(!html.includes("<script>"), html);
  assert.ok(html.includes("&lt;script&gt;"), html);
});

test("a multi-line value keeps its lines in the HTML body", () => {
  // A bare `\n` inside a `<p>` is whitespace, so without this the whole agenda
  // arrives on one line.
  const html = renderEmailBodyHtml("<p>{{meeting_agenda}}</p>", {
    meeting_agenda: "Agenda:\n• Welcome (10 min)",
  });

  assert.equal(html, "<p>Agenda:<br />• Welcome (10 min)</p>");
});

test("a field that resolves to nothing leaves no empty paragraph", () => {
  const html = renderEmailBodyHtml(
    "<p>Before</p><p>{{meeting_agenda}}</p><p>After</p>",
    { meeting_agenda: "" }
  );

  assert.equal(html, "<p>Before</p><p>After</p>");
});

test("the text half collapses the gap the same way", () => {
  assert.equal(
    renderEmailBodyText("Before\n\n{{meeting_agenda}}\n\nAfter", {
      meeting_agenda: "",
    }),
    "Before\n\nAfter"
  );
});

test("a subject is one line however many the value has", () => {
  // A subject is an email HEADER, and `{{meeting_agenda}}` is the first merge
  // value with newlines in it.
  assert.equal(
    renderSubject("{{meeting_title}}: {{meeting_agenda}}", {
      meeting_title: "Sync",
      meeting_agenda: "Agenda:\n• Welcome (10 min)",
    }),
    "Sync: Agenda: • Welcome (10 min)"
  );
});

// ============================================================================
// The whole path, on the template a team meeting actually opens with
// ============================================================================

const teamInvitation = SYSTEM_TEMPLATES.find(
  (t) => t.name === MEETING_INVITATION_TEMPLATE_NAMES.team_meeting
);

test("the team-meeting invitation puts the agenda in the body", () => {
  assert.ok(teamInvitation, "the team-meeting invitation is seeded");

  const html = renderEmailBodyHtml(toRichTextHtml(teamInvitation.body), {
    ...buildMeetingMergeData({
      ...MEETING,
      agenda: [
        { id: "1", title: "Welcome", minutes: 10 },
        { id: "2", title: "Set list", minutes: 25 },
      ],
    }),
    first_name: "Sarah",
    church_name: "New Life",
  });

  assert.ok(html.includes("Agenda:"), html);
  assert.ok(html.includes("• Welcome (10 min)<br />• Set list (25 min)"), html);
});

test("…and leaves no agenda section behind when there is no agenda", () => {
  assert.ok(teamInvitation);

  const html = renderEmailBodyHtml(toRichTextHtml(teamInvitation.body), {
    ...buildMeetingMergeData({ ...MEETING, agenda: null }),
    first_name: "Sarah",
    church_name: "New Life",
  });

  assert.ok(!html.includes("Agenda"), html);
  assert.ok(!/<p>\s*<\/p>/.test(html), html);
  // The rest of the email is untouched — this is a section that is absent, not
  // a body that lost its middle.
  assert.ok(html.includes("Hi Sarah"), html);
  assert.ok(html.includes("Room 2"), html);
});
