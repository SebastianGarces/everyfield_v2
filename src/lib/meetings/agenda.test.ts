import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agendaTotalMinutes,
  buildDefaultAgenda,
  MAX_AGENDA_SECTIONS,
  MAX_SECTION_MINUTES,
  MAX_SECTION_TITLE_LENGTH,
  parseAgenda,
  VISION_MEETING_DEFAULT_AGENDA,
  type AgendaSection,
} from "./agenda";
import { defaultAgendaForType } from "./service";

// ----------------------------------------------------------------------------
// VM-013 — the meeting agenda.
//
// `church_meetings.agenda` is an untyped `jsonb` column, so the reader is the
// only thing standing between a malformed row and a broken meeting page. These
// tests pin the two halves of that contract: the six-section default a new
// vision meeting is offered, and `parseAgenda` staying total over any input.
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// The offered default
// ----------------------------------------------------------------------------

test("the vision meeting default is the six named sections, in order", () => {
  assert.deepEqual(
    VISION_MEETING_DEFAULT_AGENDA.map((section) => section.title),
    ["Welcome", "Worship", "Vision", "Q&A", "Response", "Fellowship"]
  );
});

test("every default section carries a positive, in-range timing", () => {
  for (const section of VISION_MEETING_DEFAULT_AGENDA) {
    assert.ok(
      Number.isInteger(section.minutes),
      `${section.title} has a non-integer timing`
    );
    assert.ok(section.minutes > 0, `${section.title} has no timing`);
    assert.ok(section.minutes <= MAX_SECTION_MINUTES);
  }
});

test("the default agenda totals to a duration the header can show", () => {
  assert.equal(agendaTotalMinutes(buildDefaultAgenda()), 90);
});

test("buildDefaultAgenda mints fresh ids and never shares objects", () => {
  const first = buildDefaultAgenda();
  const second = buildDefaultAgenda();

  const ids = new Set(first.map((section) => section.id));
  assert.equal(ids.size, first.length, "ids within one agenda must be unique");

  for (let i = 0; i < first.length; i++) {
    assert.notEqual(
      first[i].id,
      second[i].id,
      "two meetings must not share section ids"
    );
    assert.notEqual(
      first[i],
      VISION_MEETING_DEFAULT_AGENDA[i],
      "the constant must not be handed out by reference"
    );
  }
});

test("only vision meetings are offered a default running order", () => {
  assert.equal(defaultAgendaForType("vision_meeting").length, 6);
  assert.deepEqual(defaultAgendaForType("team_meeting"), []);
  assert.deepEqual(defaultAgendaForType("orientation"), []);
});

// ----------------------------------------------------------------------------
// parseAgenda — total over anything the column can hold
// ----------------------------------------------------------------------------

test("an absent or unreadable agenda parses to the empty state, not a throw", () => {
  for (const value of [
    null,
    undefined,
    "",
    "welcome, worship",
    42,
    {},
    { sections: [] },
    [null, undefined, 7, "x", []],
  ]) {
    assert.deepEqual(
      parseAgenda(value),
      [],
      `failed on ${JSON.stringify(value)}`
    );
  }
});

test("a stored agenda parses back to ordered sections with timings", () => {
  const stored = [
    { id: "a", title: "Welcome", minutes: 10 },
    { id: "b", title: "Vision", minutes: 25 },
    { id: "c", title: "Response", minutes: 5 },
  ];

  assert.deepEqual(parseAgenda(stored), stored);
  assert.equal(agendaTotalMinutes(parseAgenda(stored)), 40);
});

test("a section with no readable title is dropped, not rendered blank", () => {
  const parsed = parseAgenda([
    { id: "a", title: "Welcome", minutes: 10 },
    { id: "b", title: "   ", minutes: 10 },
    { id: "c", minutes: 10 },
    { id: "d", title: 5, minutes: 10 },
    { id: "e", title: "Fellowship", minutes: 15 },
  ]);

  assert.deepEqual(
    parsed.map((section) => section.title),
    ["Welcome", "Fellowship"]
  );
});

test("a section with no id is given one so the UI has a stable key", () => {
  const [section] = parseAgenda([{ title: "Welcome", minutes: 10 }]);

  assert.equal(typeof section.id, "string");
  assert.ok(section.id.length > 0);
});

test("timings are coerced to an integer inside [0, MAX_SECTION_MINUTES]", () => {
  const parsed = parseAgenda([
    { id: "a", title: "Missing", minutes: undefined },
    { id: "b", title: "Text", minutes: "20" },
    { id: "c", title: "Junk", minutes: "soon" },
    { id: "d", title: "Negative", minutes: -30 },
    { id: "e", title: "Fractional", minutes: 12.4 },
    { id: "f", title: "Absurd", minutes: 99999 },
    { id: "g", title: "Infinite", minutes: Number.POSITIVE_INFINITY },
  ]);

  assert.deepEqual(
    parsed.map((section) => section.minutes),
    [0, 20, 0, 0, 12, MAX_SECTION_MINUTES, 0]
  );
});

test("a title longer than the column's limit is truncated, not refused", () => {
  const [section] = parseAgenda([
    { id: "a", title: "W".repeat(MAX_SECTION_TITLE_LENGTH + 50), minutes: 10 },
  ]);

  assert.equal(section.title.length, MAX_SECTION_TITLE_LENGTH);
});

test("an oversized agenda is capped rather than written whole", () => {
  const oversized = Array.from(
    { length: MAX_AGENDA_SECTIONS + 25 },
    (_, i) => ({
      id: `s-${i}`,
      title: `Section ${i}`,
      minutes: 5,
    })
  );

  assert.equal(parseAgenda(oversized).length, MAX_AGENDA_SECTIONS);
});

// ----------------------------------------------------------------------------
// The editing operations the builder performs — all of them are "the running
// order is now this array", which is what the whole-array save relies on.
// ----------------------------------------------------------------------------

function move(
  sections: AgendaSection[],
  index: number,
  direction: -1 | 1
): AgendaSection[] {
  const next = [...sections];
  const [moved] = next.splice(index, 1);
  next.splice(index + direction, 0, moved);
  return next;
}

test("add, reorder, retime and remove all survive a round trip through the column", () => {
  let agenda = buildDefaultAgenda();

  // Add
  agenda = parseAgenda([
    ...agenda,
    { id: "extra", title: "Communion", minutes: 8 },
  ]);
  assert.equal(agenda.length, 7);
  assert.equal(agenda[6].title, "Communion");

  // Reorder — Worship ahead of Welcome
  agenda = parseAgenda(move(agenda, 1, -1));
  assert.deepEqual(
    agenda.slice(0, 2).map((section) => section.title),
    ["Worship", "Welcome"]
  );

  // Retime
  const before = agendaTotalMinutes(agenda);
  agenda = parseAgenda(
    agenda.map((section) =>
      section.title === "Vision" ? { ...section, minutes: 35 } : section
    )
  );
  assert.equal(agendaTotalMinutes(agenda), before + 10);

  // Remove
  agenda = parseAgenda(
    agenda.filter((section) => section.title !== "Communion")
  );
  assert.equal(agenda.length, 6);
  assert.ok(!agenda.some((section) => section.title === "Communion"));
});

test("an empty running order totals to zero rather than nothing", () => {
  assert.equal(agendaTotalMinutes([]), 0);
});
