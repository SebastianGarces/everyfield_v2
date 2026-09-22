import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import type { CapturedCall } from "./host-capture";
import {
  meetingAttendanceFixtureIds,
  observedMeetingAttendanceFacts,
} from "./meeting-attendance";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (key: string, facts: Record<string, string>) => ({
  id: key,
  label: key,
  facts: Object.entries(facts).map(([label, value]) => ({ label, value })),
});
const meeting = (
  n: number,
  actual: number | null,
  type = "Vision Meeting",
  status = "Completed"
) =>
  row(id(n), {
    "Local start": `2026-09-${20 - n} 10:00:00`,
    Timezone: "America/New_York",
    Type: type,
    Status: status,
    "Actual attendance": actual === null ? "Not recorded" : String(actual),
  });
const att = (
  n: number,
  m: number,
  p: number,
  status = "Attended",
  rsvp = "Confirmed"
) =>
  row(id(100 + n), {
    meeting_id: id(m),
    person_id: id(200 + p),
    Attendance: status,
    RSVP: rsvp,
  });
function read(
  name: string,
  input: unknown,
  items: ReturnType<typeof row>[],
  matched = items.length,
  next = "End of results",
  mode = "list",
  groups = items.length
): CapturedCall {
  return {
    id: `${name}-${JSON.stringify(input)}`,
    name,
    input,
    output: {
      kind: "read",
      resultMode: mode,
      counts: { matched, returned: items.length },
      items,
      filters: [
        { label: "Next page cursor", value: next },
        { label: "Matching groups", value: String(groups) },
      ],
    },
  };
}
const selected = [
  meeting(1, 0),
  meeting(2, 1),
  meeting(3, 2),
  meeting(4, 2),
  meeting(5, 3),
  meeting(6, 1),
];
const meetingInput = {
  where: {
    all: [
      { timing: "past", types: ["vision_meeting"], statuses: ["completed"] },
    ],
  },
  query: { mode: "list", sort: "date", direction: "desc", limit: 6 },
};
const meetingRead = () =>
  read("meetings.query", meetingInput, selected, 8, "6");
const attendance = [
  att(1, 2, 1),
  att(2, 3, 1),
  att(3, 3, 2),
  att(4, 4, 2),
  att(5, 4, 3),
  att(6, 5, 1),
  att(7, 5, 3),
  att(8, 5, 4),
  att(9, 6, 4),
];
const listInput = {
  meetingIds: selected.map((r) => r.id),
  statuses: ["attended"],
  result: { mode: "list", limit: 50 },
};
const listRead = () => read("attendance.query", listInput, attendance);

test("three bindings preserve exact original questions", () => {
  assert.deepEqual(
    meetingAttendanceFixtureIds.map(
      (id) => questions.find((q) => q.id === id)?.turns
    ),
    [
      ["When is our next orientation?"],
      ["Show guests who accepted the invitation but were absent."],
      ["Compare attendance over our last six Vision Meetings."],
    ]
  );
  assert.deepEqual(observedMeetingAttendanceFacts("other", []), {
    facts: {},
    evidence: [],
  });
});
test("next orientation permits exact top one or complete broader upcoming results", () => {
  const chosen = meeting(1, null, "Orientation", "Ready");
  const scoped = read(
    "meetings.query",
    {
      where: {
        all: [
          {
            timing: "upcoming",
            types: ["orientation"],
            statuses: ["planning", "ready", "in_progress", "completed"],
          },
        ],
      },
      query: { mode: "list", limit: 1 },
    },
    [chosen],
    3,
    "1"
  );
  const complete = read(
    "meetings.query",
    { where: { all: [{ timing: "upcoming" }] }, query: { mode: "list" } },
    [
      meeting(2, null, "Orientation", "Cancelled"),
      meeting(3, null, "Vision Meeting", "Ready"),
      chosen,
    ]
  );
  const expected = observedMeetingAttendanceFacts("orientations-01", [scoped]);
  assert.equal(expected.facts.nextOrientationId, chosen.id);
  assert.deepEqual(
    observedMeetingAttendanceFacts("orientations-01", [complete]),
    expected
  );
  const scheduling = structuredClone(scoped);
  scheduling.input = {
    where: {
      all: [
        {
          timing: "upcoming",
          types: ["orientation"],
          statuses: ["planning", "ready"],
        },
      ],
    },
    query: { mode: "list", limit: 1 },
  };
  assert.deepEqual(
    observedMeetingAttendanceFacts("orientations-01", [scheduling]),
    expected
  );
  const restricted = structuredClone(scoped);
  restricted.input = {
    where: {
      all: [
        { timing: "upcoming", types: ["orientation"], statuses: ["ready"] },
      ],
    },
    query: { mode: "list", limit: 1 },
  };
  assert.deepEqual(
    observedMeetingAttendanceFacts("orientations-01", [restricted]).facts,
    {}
  );
});
test("top six retains finalized zero and distinct people instead of summing person appearances", () => {
  const calls = [meetingRead(), listRead()],
    observed = observedMeetingAttendanceFacts("meetings-06", calls);
  assert.equal(observed.facts.recordedAttendance, 9);
  assert.equal(observed.facts.distinctRecordedPeople, 4);
  assert.ok(
    (observed.facts.attendanceByMeeting as string[]).includes(`${id(1)}:0`)
  );
  assert.deepEqual(
    observed,
    observedMeetingAttendanceFacts(
      "meetings-06",
      calls,
      new Set(calls.map((c) => c.id))
    )
  );
  const broad = read(
    "meetings.query",
    { where: { all: [{ timing: "past" }] }, query: { mode: "list" } },
    [
      meeting(7, 1),
      ...selected,
      meeting(8, null, "Vision Meeting", "Cancelled"),
    ]
  );
  assert.deepEqual(
    observedMeetingAttendanceFacts("meetings-06", [broad, listRead()]),
    observed
  );
});
test("completed top-six reads prove past timing from returned local starts without a redundant filter", () => {
  const withoutTiming = read(
    "meetings.query",
    {
      where: { all: [{ types: ["vision_meeting"], statuses: ["completed"] }] },
      query: { mode: "list", sort: "date", direction: "desc", limit: 6 },
    },
    selected,
    8,
    "6"
  );
  assert.deepEqual(
    observedMeetingAttendanceFacts("meetings-06", [withoutTiming, listRead()]),
    observedMeetingAttendanceFacts("meetings-06", [meetingRead(), listRead()])
  );
  for (const replacement of [
    { "Local start": "2026-09-20 12:01:00" },
    { "Local start": "2026-09-20 12:00:00" },
    { Timezone: "Pacific/Honolulu" },
  ]) {
    const rows = structuredClone(selected);
    rows[0].facts = rows[0].facts.map((fact) => ({
      ...fact,
      value:
        Object.entries(replacement).find(
          ([label]) => label === fact.label
        )?.[1] ?? fact.value,
    }));
    const invalid = read("meetings.query", withoutTiming.input, rows, 8, "6");
    assert.deepEqual(
      observedMeetingAttendanceFacts("meetings-06", [invalid, listRead()])
        .facts,
      {}
    );
  }
  const wrongOrder = read(
    "meetings.query",
    {
      where: { all: [{ types: ["vision_meeting"], statuses: ["completed"] }] },
      query: { mode: "list", sort: "date", direction: "asc", limit: 6 },
    },
    selected,
    8,
    "6"
  );
  assert.deepEqual(
    observedMeetingAttendanceFacts("meetings-06", [wrongOrder, listRead()])
      .facts,
    {}
  );
});

test("comparison accepts full grouped counts plus exact overall distinct count", () => {
  const groups = selected.slice(1).map((m, i) =>
    row(`group-${i}`, {
      "Group key": `Vision [${m.id}]`,
      Records: String([1, 2, 2, 3, 1][i]),
      "Distinct people": String([1, 2, 2, 3, 1][i]),
    })
  );
  const group = read(
    "attendance.query",
    { ...listInput, result: { mode: "group", by: "meeting" } },
    groups,
    9,
    "End of results",
    "group"
  );
  const count = read(
    "attendance.query",
    { ...listInput, result: { mode: "count" } },
    [row("total", { Records: "9", "Distinct people": "4" })],
    9,
    "End of results",
    "count"
  );
  assert.deepEqual(
    observedMeetingAttendanceFacts("meetings-06", [
      meetingRead(),
      group,
      count,
    ]),
    observedMeetingAttendanceFacts("meetings-06", [meetingRead(), listRead()])
  );
  const wrong = structuredClone(count);
  wrong.input = {
    ...listInput,
    rsvp: ["confirmed"],
    result: { mode: "count" },
  };
  assert.deepEqual(
    observedMeetingAttendanceFacts("meetings-06", [meetingRead(), group, wrong])
      .facts,
    {}
  );
});
test("unfinalized meeting stays in the last six, and is not silently replaced or counted zero", () => {
  const meetings = read(
    "meetings.query",
    meetingInput,
    selected.map((r, i) => (i === 2 ? meeting(3, null) : r)),
    8,
    "6"
  );
  const input = {
    ...listInput,
    meetingIds: selected.filter((_, i) => i !== 2).map((r) => r.id),
  };
  const records = attendance.filter(
    (r) => !r.facts.some((f) => f.label === "meeting_id" && f.value === id(3))
  );
  const observed = observedMeetingAttendanceFacts("meetings-06", [
    meetings,
    read("attendance.query", input, records),
  ]);
  assert.deepEqual(observed.facts.unknownMeetingIds, [id(3)]);
  assert.equal(observed.facts.recordedAttendance, 7);
  assert.ok(
    (observed.facts.attendanceByMeeting as string[]).includes(
      `${id(3)}:unknown`
    )
  );
  assert.deepEqual(
    observedMeetingAttendanceFacts("meetings-06", [meetings, listRead()]).facts,
    {}
  );
});
test("accepted guests are no-shows only within finalized meetings, never default absent before finalization", () => {
  const meetings = read(
    "meetings.query",
    {
      where: { all: [{ timing: "past", statuses: ["completed"] }] },
      query: { mode: "list" },
    },
    [meeting(1, 1), meeting(2, null)]
  );
  const input = { meetingIds: [id(1)], result: { mode: "list" } };
  const records = [
    att(1, 1, 1, "Absent"),
    att(2, 1, 2, "Attended"),
    att(3, 1, 3, "Excused"),
    att(4, 1, 4, "Absent", "Declined"),
  ];
  assert.deepEqual(
    observedMeetingAttendanceFacts("meetings-03", [
      meetings,
      read("attendance.query", input, records),
    ]).facts,
    { noShowPairs: [`${id(1)}:${id(201)}`] }
  );
  assert.deepEqual(
    observedMeetingAttendanceFacts("meetings-03", [
      meetings,
      read("attendance.query", { ...input, meetingIds: [id(1), id(2)] }, [
        ...records,
        att(5, 2, 5, "Absent"),
      ]),
    ]).facts,
    {}
  );
});

test("all six unfinalized meetings produce unknown totals without manufacturing zero attendance", () => {
  const meetings = read(
    "meetings.query",
    meetingInput,
    selected.map((_, index) => meeting(index + 1, null)),
    8,
    "6"
  );
  const observed = observedMeetingAttendanceFacts("meetings-06", [meetings]);
  assert.equal(observed.facts.recordedAttendance, null);
  assert.equal(observed.facts.distinctRecordedPeople, null);
  assert.deepEqual(
    observed.facts.unknownMeetingIds,
    selected.map((r) => r.id).sort()
  );
});
test("coherent paginated meetings and attendance agree; gaps, duplicates, wrong filters and stale refresh fail", () => {
  const firstMeetings = read(
    "meetings.query",
    { ...meetingInput, query: { ...meetingInput.query, limit: 3 } },
    selected.slice(0, 3),
    8,
    "3"
  );
  const secondMeetings = read(
    "meetings.query",
    {
      ...meetingInput,
      query: { ...meetingInput.query, limit: 3, cursor: "3" },
    },
    selected.slice(3),
    8,
    "6"
  );
  const first = read(
    "attendance.query",
    { ...listInput, result: { mode: "list", limit: 5 } },
    attendance.slice(0, 5),
    9,
    attendance[4]!.id
  );
  const second = read(
    "attendance.query",
    {
      ...listInput,
      result: { mode: "list", limit: 5, afterId: attendance[4]!.id },
    },
    attendance.slice(5),
    9
  );
  const baseline = observedMeetingAttendanceFacts("meetings-06", [
    meetingRead(),
    listRead(),
  ]);
  assert.deepEqual(
    observedMeetingAttendanceFacts("meetings-06", [
      firstMeetings,
      secondMeetings,
      first,
      second,
    ]),
    baseline
  );
  for (const suffix of [
    [first],
    [second],
    [first, second, first],
    [first, { ...second, output: first.output }],
    [
      {
        ...listRead(),
        input: { ...listInput, cohort: { stages: ["prospect"] } },
      },
    ],
  ])
    assert.deepEqual(
      observedMeetingAttendanceFacts("meetings-06", [meetingRead(), ...suffix])
        .facts,
      {}
    );
  assert.deepEqual(
    observedMeetingAttendanceFacts("meetings-06", [
      meetingRead(),
      listRead(),
      firstMeetings,
    ]).facts,
    {}
  );
});

test("new same-cohort list and aggregate sequences cannot borrow older representations", () => {
  const groups = selected.slice(1).map((m, i) =>
    row(`group-${i}`, {
      "Group key": `Vision [${m.id}]`,
      Records: String([1, 2, 2, 3, 1][i]),
      "Distinct people": String([1, 2, 2, 3, 1][i]),
    })
  );
  const group = read(
    "attendance.query",
    { ...listInput, result: { mode: "group", by: "meeting" } },
    groups,
    9,
    "End of results",
    "group"
  );
  const count = read(
    "attendance.query",
    { ...listInput, result: { mode: "count" } },
    [row("total", { Records: "9", "Distinct people": "4" })],
    9,
    "End of results",
    "count"
  );
  const partialList = read(
    "attendance.query",
    { ...listInput, result: { mode: "list", limit: 1 } },
    attendance.slice(0, 1),
    10,
    attendance[0]!.id
  );
  const partialGroup = read(
    "attendance.query",
    { ...listInput, result: { mode: "group", by: "meeting" } },
    groups.slice(0, 1),
    9,
    "1",
    "group",
    5
  );
  const baseline = observedMeetingAttendanceFacts("meetings-06", [
    meetingRead(),
    listRead(),
  ]);
  for (const suffix of [
    [group, count, partialList],
    [listRead(), partialGroup],
    [group, count, listRead(), partialGroup],
    [listRead(), count],
  ]) {
    assert.deepEqual(
      observedMeetingAttendanceFacts("meetings-06", [meetingRead(), ...suffix])
        .facts,
      {}
    );
    assert.deepEqual(
      observedMeetingAttendanceFacts("meetings-06", [
        meetingRead(),
        ...suffix,
        listRead(),
      ]),
      baseline
    );
    assert.deepEqual(
      observedMeetingAttendanceFacts("meetings-06", [
        meetingRead(),
        ...suffix,
        group,
        count,
      ]),
      baseline
    );
    assert.deepEqual(
      observedMeetingAttendanceFacts("meetings-06", [
        meetingRead(),
        ...suffix,
        count,
        group,
      ]),
      baseline
    );
  }
  const unrelated = read(
    "attendance.query",
    { meetingIds: [id(999)], result: { mode: "list" } },
    [],
    1,
    "1"
  );
  assert.deepEqual(
    observedMeetingAttendanceFacts("meetings-06", [
      meetingRead(),
      group,
      count,
      unrelated,
    ]),
    baseline
  );
});

test("valid unrestricted cohort forms are equivalent, while narrowed and invalid cohorts are not", () => {
  const baseline = observedMeetingAttendanceFacts("meetings-06", [
    meetingRead(),
    listRead(),
  ]);
  for (const cohort of [
    {},
    { all: {} },
    { anyOf: [{}] },
    { all: {}, anyOf: [{}] },
  ]) {
    const list = listRead();
    list.input = { ...listInput, cohort };
    assert.deepEqual(
      observedMeetingAttendanceFacts("meetings-06", [meetingRead(), list]),
      baseline
    );
  }
  for (const cohort of [
    { all: { stages: ["prospect"] } },
    { all: { personIds: [id(201)] } },
    { anyOf: [{ stages: ["prospect"] }] },
    { all: [] },
    { anyOf: [] },
    { none: [] },
  ]) {
    const list = listRead();
    list.input = { ...listInput, cohort };
    assert.deepEqual(
      observedMeetingAttendanceFacts("meetings-06", [meetingRead(), list])
        .facts,
      {}
    );
  }
});
