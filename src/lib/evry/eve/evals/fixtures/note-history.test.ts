import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import type { CapturedCall } from "./host-capture";
import {
  noteHistoryFixtureIds,
  observedNoteHistoryFacts,
} from "./note-history";

const note = (id: string, person = "alex") => ({
  id,
  label: person,
  facts: [
    { label: "person_id", value: person },
    { label: "author_id", value: "author" },
    { label: "Recorded at (UTC)", value: "2026-09-12T18:15:00.000Z" },
    { label: "Recorded notes", value: "Interested in volunteering." },
  ],
});
const call = (items = [note("a")]): CapturedCall => ({
  id: "read",
  name: "people.history.query",
  input: {
    resource: { kind: "notes" },
    text: "volunteering",
    result: { mode: "list", limit: 1 },
  },
  output: { kind: "read", counts: { matched: items.length }, items },
});

test("note cases retain their original questions", () => {
  assert.deepEqual(
    noteHistoryFixtureIds.map(
      (id) => questions.find((q) => q.id === id)?.turns
    ),
    [
      ["Show the latest notes for Alex and Casey together."],
      ["Find people whose notes mention an interest in volunteering."],
      ["Summarize what changed for Alex since our last meeting."],
    ]
  );
});
test("evidence is independent of optional cards, not proof of prose correctness", () => {
  const a = observedNoteHistoryFacts("notes-02", [call()], new Set());
  assert.deepEqual(
    a,
    observedNoteHistoryFacts("notes-02", [call()], new Set(["read"]))
  );
  assert.deepEqual(a.evidence, ["recorded:notes-02"]);
  assert.deepEqual(
    observedNoteHistoryFacts(
      "notes-02",
      [{ ...call(), output: { answer: "Found people" } }],
      new Set()
    ),
    { facts: {}, evidence: [] }
  );
});
test("pagination must be complete, unique and coherent; identical refreshes are allowed", () => {
  const first = {
    ...call(),
    output: { kind: "read", counts: { matched: 2 }, items: [note("a")] },
  };
  const second = {
    ...call(),
    id: "next",
    input: {
      resource: { kind: "notes" },
      text: "volunteering",
      result: { mode: "list", limit: 1, cursor: "a" },
    },
    output: {
      kind: "read",
      counts: { matched: 2 },
      items: [note("b", "casey")],
    },
  };
  const read = (calls: CapturedCall[]) =>
    observedNoteHistoryFacts("notes-02", calls, new Set());
  assert.deepEqual(read([first]), { facts: {}, evidence: [] });
  assert.deepEqual(read([first, second]).facts.personIds, ["alex", "casey"]);
  assert.deepEqual(read([first, second, first, second]), read([first, second]));
  assert.deepEqual(read([first, second, second]), { facts: {}, evidence: [] });
  assert.deepEqual(
    read([
      first,
      {
        ...second,
        input: {
          resource: { kind: "notes" },
          text: "different",
          result: { mode: "list", cursor: "a" },
        },
      },
    ]),
    { facts: {}, evidence: [] }
  );
});
test("incomplete note content and absent author/time never count as complete evidence", () => {
  for (const missing of ["author_id", "Recorded at (UTC)"]) {
    const item = note("a");
    item.facts = item.facts.filter((f) => f.label !== missing);
    assert.deepEqual(
      observedNoteHistoryFacts("notes-02", [call([item])], new Set()),
      { facts: {}, evidence: [] }
    );
  }
  const item = note("a");
  item.facts.push({ label: "Next content offset", value: "240" });
  assert.deepEqual(
    observedNoteHistoryFacts("notes-02", [call([item])], new Set()),
    { facts: {}, evidence: [] }
  );
});

test("since-meeting evidence requires the retrieved wall clock resolved in its church zone", () => {
  const meeting: CapturedCall = {
    id: "meeting",
    name: "meetings.query",
    input: {},
    output: {
      kind: "read",
      counts: { matched: 1 },
      items: [
        {
          id: "meeting-id",
          label: "Last meeting",
          facts: [
            { label: "Local start", value: "2026-09-10T14:00:00" },
            { label: "Timezone", value: "America/New_York" },
          ],
        },
      ],
    },
  };
  const calendar: CapturedCall = {
    id: "calendar",
    name: "calendar.resolve",
    input: {
      date: { kind: "absolute", date: "2026-09-10" },
      localTime: "14:00",
    },
    output: {
      status: "resolved",
      timeZone: "America/New_York",
      calendarDate: "2026-09-10",
      localTime: "14:00",
      instantUtc: "2026-09-10T18:00:00.000Z",
    },
  };
  const itemAt = (id: string, instant: string) => {
    const item = note(id);
    item.facts = item.facts.map((f) =>
      f.label === "Recorded at (UTC)" ? { ...f, value: instant } : f
    );
    return item;
  };
  const after = itemAt("after", "2026-09-10T18:00:01.000Z");
  const history: CapturedCall = {
    ...call([after]),
    input: {
      resource: { kind: "activities" },
      recordIds: ["after"],
      result: { mode: "list" },
    },
  };
  const observe = (calls: CapturedCall[]) =>
    observedNoteHistoryFacts("notes-04", calls);
  const valid = observe([meeting, calendar, history]);
  assert.equal(valid.facts.meetingInstant, "2026-09-10T18:00:00.000Z");
  assert.deepEqual(
    valid,
    observedNoteHistoryFacts(
      "notes-04",
      [meeting, calendar, history],
      new Set(["read"])
    )
  );
  assert.deepEqual(observe([meeting, history]), { facts: {}, evidence: [] });
  for (const invalid of [
    {
      ...calendar,
      output: {
        status: "resolved",
        timeZone: "America/New_York",
        calendarDate: "2026-09-10",
        instantUtc: "2026-09-10T14:00:00.000Z",
        localTime: "10:00",
      },
    },
    {
      ...calendar,
      output: {
        status: "resolved",
        timeZone: "UTC",
        instantUtc: "2026-09-10T14:00:00.000Z",
      },
    },
    {
      ...calendar,
      output: { status: "needs_input", reason: "daylight_saving_fold" },
    },
  ])
    assert.deepEqual(observe([meeting, invalid, history]), {
      facts: {},
      evidence: [],
    });
  // The observer must not secretly remove incorrect records returned by the
  // agent's final selection. Both boundary errors must differ from SQL truth.
  for (const bad of [
    itemAt("before", "2026-09-10T17:59:59.000Z"),
    itemAt("at", "2026-09-10T18:00:00.000Z"),
  ]) {
    const wrong = observe([
      meeting,
      calendar,
      {
        ...history,
        output: { kind: "read", counts: { matched: 2 }, items: [bad, after] },
      },
    ]);
    assert.notDeepEqual(wrong.facts.records, valid.facts.records);
    assert.ok(Array.isArray(wrong.facts.records));
    assert.equal(wrong.facts.records.length, 2);
  }
});
