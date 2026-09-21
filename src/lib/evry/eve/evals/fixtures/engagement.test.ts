import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import {
  engagementFixtureIds,
  engagementId,
  observedEngagementFacts,
} from "./engagement";

test("six engagement bindings retain the original questions and follow-up", () => {
  assert.deepEqual(
    engagementFixtureIds.map((id) => questions.find((q) => q.id === id)?.turns),
    [
      ["List prospects added in the last 30 days with the volunteer tag."],
      [
        "Show prospects with the volunteer tag.",
        "Only the ones added this month. Keep the same tag.",
      ],
      ["What meetings are happening this week, and where?"],
      ["Which upcoming meetings have unfinished preparation checklists?"],
      ["What feedback did we record for our last two meetings?"],
      ["Who attended orientation but has not joined a ministry?"],
    ]
  );
});

test("engagement IDs are deterministic and isolated between cases and repetitions", () => {
  const value = engagementId(
    createFixtureManifest("people-02", 0),
    "month-start"
  );
  assert.equal(
    value,
    engagementId(createFixtureManifest("people-02", 0), "month-start")
  );
  assert.notEqual(
    value,
    engagementId(createFixtureManifest("people-02", 1), "month-start")
  );
  assert.notEqual(
    value,
    engagementId(createFixtureManifest("people-08", 0), "month-start")
  );
});

test("model-written facts and absent captures cannot establish engagement evidence", () => {
  for (const id of engagementFixtureIds) {
    assert.deepEqual(observedEngagementFacts(id, [], new Set()), {
      facts: {},
      evidence: [],
    });
    assert.deepEqual(
      observedEngagementFacts(
        id,
        [
          {
            id: "untrusted",
            name: "people.query",
            input: {},
            output: {
              facts: { peopleIds: ["alex"] },
              answer: "I checked everyone.",
            },
          },
        ],
        new Set(["untrusted"])
      ),
      { facts: {}, evidence: [] }
    );
  }
});

function peoplePage(
  id: string,
  ids: string[],
  matched: number,
  created?: { from: string; through: string },
  afterId?: string
): CapturedCall {
  return {
    id,
    name: "people.query",
    input: {
      cohort: {
        all: {
          stages: ["prospect"],
          tags: { names: ["volunteer"] },
          ...(created ? { created } : {}),
        },
      },
      result: { mode: "list", limit: 2, ...(afterId ? { afterId } : {}) },
    },
    output: {
      kind: "read",
      counts: { matched },
      items: ids.map((id) => ({ id, label: id })),
    },
  };
}

test("tag follow-up records initial and narrowed cohorts without mixing their pages", () => {
  const calls = [
    peoplePage("first", ["a", "b"], 3),
    peoplePage("second", ["c"], 3, undefined, "b"),
    peoplePage("narrowed", ["b"], 1, {
      from: "2026-09-01",
      through: "2026-09-30",
    }),
  ];
  assert.deepEqual(observedEngagementFacts("people-08", calls, new Set()), {
    facts: { initialPeopleIds: ["a", "b", "c"], peopleIds: ["b"] },
    evidence: ["complete-tagged-prospect-window"],
  });
  assert.deepEqual(
    observedEngagementFacts("people-08", calls.slice(1), new Set()).evidence,
    []
  );
});

test("month-to-date evidence uses actual returned records, without hiding future rows in the observer", () => {
  const initial = peoplePage("initial", ["past", "future"], 2);
  const narrowed = peoplePage("month-to-date", ["past"], 1);
  narrowed.input = {
    cohort: {
      all: {
        stages: ["prospect"],
        tags: { names: ["volunteer"] },
        createdWindow: {
          from: "2026-09-01T04:00:00Z",
          until: "2026-09-20T16:00:00Z",
        },
      },
    },
    result: { mode: "list", limit: 2 },
  };
  assert.deepEqual(
    observedEngagementFacts("people-08", [initial, narrowed], new Set()).facts,
    { initialPeopleIds: ["future", "past"], peopleIds: ["past"] }
  );
  const wrong = { ...narrowed, output: initial.output };
  assert.deepEqual(
    observedEngagementFacts("people-08", [initial, wrong], new Set()).facts
      .peopleIds,
    ["future", "past"]
  );
});

test("partial and duplicated pages cannot establish complete result evidence", () => {
  for (const calls of [
    [peoplePage("first", ["a", "b"], 3)],
    [
      peoplePage("first", ["a", "b"], 3),
      peoplePage("second", ["b"], 3, undefined, "b"),
    ],
  ]) {
    assert.deepEqual(
      observedEngagementFacts("people-02", calls, new Set()).evidence,
      []
    );
  }
  assert.deepEqual(
    observedEngagementFacts(
      "people-02",
      [
        peoplePage("first", ["a", "b"], 3),
        peoplePage("second", ["c"], 3, undefined, "b"),
      ],
      new Set()
    ).evidence,
    ["complete-tagged-prospect-window"]
  );
});

test("a repeated complete query uses the refreshed records, not a union of both reads", () => {
  const initial = peoplePage("initial", ["old"], 1);
  const current = peoplePage("refresh", ["a", "b"], 2);
  assert.deepEqual(
    observedEngagementFacts(
      "people-02",
      [initial, current, { ...current, id: "again" }],
      new Set()
    ),
    {
      facts: { peopleIds: ["a", "b"] },
      evidence: ["complete-tagged-prospect-window"],
    }
  );
  assert.deepEqual(
    observedEngagementFacts(
      "people-02",
      [
        peoplePage("complete", ["a", "b"], 2),
        peoplePage("incomplete-refresh", ["a"], 2),
      ],
      new Set()
    ).evidence,
    []
  );
});

test("an entire paginated refresh replaces the old pagination run", () => {
  const calls = [
    peoplePage("old-first", ["a", "b"], 3),
    peoplePage("old-next", ["c"], 3, undefined, "b"),
    peoplePage("refresh-first", ["b", "d"], 3),
    peoplePage("refresh-next", ["e"], 3, undefined, "d"),
  ];
  assert.deepEqual(observedEngagementFacts("people-02", calls, new Set()), {
    facts: { peopleIds: ["b", "d", "e"] },
    evidence: ["complete-tagged-prospect-window"],
  });
  assert.deepEqual(
    observedEngagementFacts("people-02", calls.slice(0, -1), new Set())
      .evidence,
    []
  );
});

test("equivalent nested filter key order keeps pages in the same read", () => {
  const window = { from: "2026-09-01", through: "2026-09-30" };
  const first = peoplePage("first", ["a", "b"], 3, window);
  const last = peoplePage("last", ["c"], 3, window, "b");
  last.input = {
    result: { afterId: "b", limit: 2, mode: "list" },
    cohort: {
      all: {
        created: { through: window.through, from: window.from },
        tags: { names: ["volunteer"] },
        stages: ["prospect"],
      },
    },
  };
  assert.deepEqual(
    observedEngagementFacts("people-02", [first, last], new Set()),
    {
      facts: { peopleIds: ["a", "b", "c"] },
      evidence: ["complete-tagged-prospect-window"],
    }
  );
});

test("missing first or middle pages and repeated continuation pages remain invalid", () => {
  const first = peoplePage("first", ["a", "b"], 4);
  const last = peoplePage("last", ["c", "d"], 4, undefined, "b");
  for (const calls of [
    [last],
    [first, peoplePage("skipped", ["e", "f"], 4, undefined, "d")],
    [first, last, { ...last, id: "repeated-continuation" }],
    [first, peoplePage("overlap", ["b", "c"], 4, undefined, "b")],
  ])
    assert.deepEqual(
      observedEngagementFacts("people-02", calls, new Set()).evidence,
      []
    );
});

test("meeting offset pages use the final read and reject missing or repeated continuations", () => {
  const page = (id: string, ids: string[], cursor?: string): CapturedCall => ({
    id,
    name: "meetings.query",
    input: {
      where: { all: [{ statuses: ["ready"], timing: "upcoming" }] },
      query: { mode: "list", limit: 2, ...(cursor ? { cursor } : {}) },
    },
    output: {
      kind: "read",
      counts: { matched: 3 },
      items: ids.map((id) => ({
        id,
        label: id,
        facts: [
          { label: "When", value: "10 AM" },
          { label: "Location", value: "Church" },
        ],
      })),
    },
  });
  const first = page("first", ["a", "b"]),
    last = page("last", ["c"], "2");
  const refreshFirst = page("refresh-first", ["a", "b"], "0"),
    refreshLast = page("refresh-last", ["c"], "2");
  refreshLast.input = {
    query: {
      direction: "asc",
      sort: "date",
      mode: "list",
      limit: 2,
      cursor: "2",
    },
    where: { all: [{ timing: "upcoming", statuses: ["ready"] }] },
  };
  const good = observedEngagementFacts(
    "meetings-01",
    [first, last, refreshFirst, refreshLast],
    new Set()
  );
  assert.deepEqual(good.facts.meetingIds, ["a", "b", "c"]);
  assert.deepEqual(good.evidence, ["complete-church-local-week"]);
  for (const calls of [
    [last],
    [first, page("missing-offset", ["c"], "4")],
    [first, last, { ...last, id: "duplicate" }],
    [first, last, refreshFirst],
  ])
    assert.deepEqual(
      observedEngagementFacts("meetings-01", calls, new Set()).evidence,
      []
    );
});

test("latest meeting feedback preserves a missing record instead of inventing feedback", () => {
  const query: CapturedCall = {
    id: "meetings",
    name: "meetings.query",
    input: {
      where: { all: [{ statuses: ["completed"] }] },
      query: { mode: "list", limit: 2, direction: "desc", sort: "date" },
    },
    output: {
      kind: "read",
      counts: { matched: 10 },
      items: [
        { id: "latest", label: "Latest" },
        { id: "second", label: "Second" },
      ],
    },
  };
  const details: CapturedCall = {
    id: "details",
    name: "meetings.get_many",
    input: { ids: ["latest", "second"], sections: ["evaluation"] },
    output: {
      kind: "read",
      counts: { matched: 2 },
      items: [
        {
          id: "latest",
          label: "Latest",
          facts: [
            { label: "Evaluation notes", value: "Not recorded" },
            { label: "Evaluation score", value: "Not recorded" },
          ],
        },
        {
          id: "second",
          label: "Second",
          facts: [
            { label: "Evaluation notes", value: "Welcome was warm." },
            { label: "Evaluation score", value: "24" },
          ],
        },
      ],
    },
  };
  assert.deepEqual(
    observedEngagementFacts("meetings-07", [query, details], new Set()),
    {
      facts: {
        meetingIds: ["latest", "second"],
        evaluations: [
          "latest: Not recorded | Not recorded",
          "second: Welcome was warm. | 24",
        ],
      },
      evidence: ["latest-two-recorded-or-missing-evaluations"],
    }
  );
  assert.deepEqual(
    observedEngagementFacts("meetings-07", [query], new Set()).evidence,
    []
  );
});
