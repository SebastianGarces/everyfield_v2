import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import {
  contentFixtureIds,
  contentId,
  contentWindows,
  observedContentFacts,
  bindContentTurns,
  missingWikiTopic,
} from "./content";
import { createHash } from "node:crypto";

test("content bindings retain nine original corpus questions", () => {
  for (const id of contentFixtureIds)
    assert.ok(questions.find((q) => q.id === id)?.turns.length);
  assert.equal(new Set(contentFixtureIds).size, 9);
});

test("wiki reference and topic clarification preserve the original corpus turn", () => {
  for (const id of ["wiki-05", "wiki-07"]) {
    const original = questions.find((q) => q.id === id)!.turns;
    const bound = bindContentTurns(createFixtureManifest(id, 0), original);
    assert.deepEqual(bound.slice(0, -1), original);
    assert.equal(bound.length, original.length + 1);
    assert.ok(
      bound.at(-1)!.includes(id === "wiki-05" ? "/wiki/" : missingWikiTopic)
    );
  }
});

const wikiPage = (
  offset: number,
  text: string,
  total: number,
  revision = "2026-09-20T00:00:00.000Z"
) => ({
  id: `read-${offset}`,
  name: "wiki.read_many",
  input: { articles: [{ slug: "guide", offset, revision }] },
  output: {
    kind: "read",
    counts: { matched: 1 },
    items: [
      {
        id: `article:${offset}`,
        label: "Guide",
        sourceLink: { href: "/wiki/guide" },
        facts: [
          { label: "Content", value: text },
          {
            label: "Citation range",
            value: `Characters ${offset + 1}-${offset + text.length} of ${total}`,
          },
          { label: "Revision", value: revision },
          {
            label: "Next offset",
            value:
              offset + text.length === total
                ? "End of article"
                : String(offset + text.length),
          },
        ],
      },
    ],
  },
});

test("wiki full-content evidence is card-independent and rejects partial, mixed revision and conflicting sources", () => {
  const pages = [wikiPage(0, "abc", 6), wikiPage(3, "def", 6)];
  for (const id of ["wiki-02", "wiki-05"]) {
    const good = observedContentFacts(id, pages, new Set());
    assert.deepEqual(good, {
      facts: {
        articleIds: ["article"],
        citations: ["article:/wiki/guide"],
        contentHashes: [
          `article:${createHash("sha256").update("abcdef").digest("hex")}`,
        ],
      },
      evidence: ["complete-wiki-source-content"],
    });
    assert.deepEqual(
      observedContentFacts(id, pages, new Set(pages.map((p) => p.id))),
      good
    );
    for (const bad of [
      [pages[0]!],
      [pages[1]!],
      [pages[0]!, wikiPage(4, "ef", 6)],
      [pages[0]!, wikiPage(3, "def", 6, "2026-09-21T00:00:00.000Z")],
      [...pages, wikiPage(0, "XYZ", 6)],
    ])
      assert.deepEqual(observedContentFacts(id, bad, new Set()).evidence, []);
  }
});

test("wiki not-found requires an unrestricted real topical search, not an arbitrary empty result", () => {
  const call = {
    id: "search",
    name: "wiki.search",
    input: { queries: [missingWikiTopic] },
    output: { kind: "read", counts: { matched: 0 }, items: [] },
  };
  assert.deepEqual(observedContentFacts("wiki-07", [call], new Set()), {
    facts: { articleIds: [], citations: [], matches: 0 },
    evidence: ["searched-missing-topic"],
  });
  for (const input of [
    { queries: [] },
    { queries: ["wrong topic"] },
    { queries: [missingWikiTopic], offset: 20 },
    { queries: [missingWikiTopic], phases: [6] },
  ])
    assert.deepEqual(
      observedContentFacts("wiki-07", [{ ...call, input }], new Set()).evidence,
      []
    );
});

test("wiki search citations preserve encoded article paths", () => {
  const call = {
    id: "search",
    name: "wiki.search",
    input: { queries: ["orientation"] },
    output: {
      kind: "read",
      counts: { matched: 1 },
      items: [
        {
          id: "local",
          label: "Guide",
          sourceLink: { href: "/wiki/guide%20%232%3F" },
          facts: [{ label: "Citation slug", value: "guide #2?" }],
        },
      ],
    },
  };
  assert.deepEqual(
    observedContentFacts("wiki-01", [call], new Set()).evidence,
    ["visible-wiki-citations"]
  );
  call.output.items[0]!.sourceLink.href = "/wiki/guide #2?";
  assert.deepEqual(
    observedContentFacts("wiki-01", [call], new Set()).evidence,
    []
  );
});

test("wiki current-phase evidence comes from authorized context, not a guessed wiki filter", () => {
  const wiki = {
    id: "wiki",
    name: "wiki.search",
    input: { phases: [2], readingStatuses: ["not_started", "in_progress"] },
    output: {
      kind: "read",
      counts: { matched: 1 },
      items: [{ id: "article", label: "Article" }],
    },
  };
  const context = {
    id: "context",
    name: "context.get",
    input: {},
    output: { currentPhase: 2 },
  };
  assert.deepEqual(
    observedContentFacts("wiki-04", [context, wiki], new Set()),
    {
      facts: { phase: 2, articleIds: ["article"] },
      evidence: ["current-phase-unfinished-corpus"],
    }
  );
  for (const calls of [
    [wiki],
    [{ ...context, output: { currentPhase: "2" } }, wiki],
    [{ ...context, name: "launch.query" }, wiki],
    [{ ...context, output: { status: "unavailable" } }, wiki],
  ]) {
    assert.deepEqual(
      observedContentFacts("wiki-04", calls, new Set()).evidence,
      []
    );
  }
});

test("wiki observation selects the final coherent query without unioning exploratory searches", () => {
  const context = {
    id: "context",
    name: "context.get",
    input: {},
    output: { currentPhase: 2 },
  };
  const page = (ids: string[], input: Record<string, unknown>, total = 3) => ({
    id: JSON.stringify({ ids, input }),
    name: "wiki.search",
    input,
    output: {
      kind: "read",
      counts: { matched: total },
      items: ids.map((id) => ({ id, label: id })),
    },
  });
  const filters = {
    phases: [2],
    readingStatuses: ["not_started", "in_progress"],
  };
  const exploratory = page(
    ["a", "b", "c", "other-phase"],
    { readingStatuses: filters.readingStatuses },
    4
  );
  const expected = {
    facts: { phase: 2, articleIds: ["a", "b", "c"] },
    evidence: ["current-phase-unfinished-corpus"],
  };
  assert.deepEqual(
    observedContentFacts(
      "wiki-04",
      [context, exploratory, page(["a", "b", "c"], filters)],
      new Set()
    ),
    expected
  );
  const first = page(["a", "b"], { ...filters, offset: 0, limit: 2 });
  const last = page(["c"], {
    ...filters,
    readingStatuses: ["in_progress", "not_started"],
    offset: 2,
    limit: 2,
  });
  assert.deepEqual(
    observedContentFacts(
      "wiki-04",
      [context, exploratory, first, last],
      new Set()
    ),
    expected
  );
  for (const incomplete of [
    [first],
    [last],
    [first, { ...last, input: { ...last.input, offset: 3 } }],
    [first, first, last],
    [page(["a", "a", "b"], filters)],
    [
      first,
      page(["c"], { ...last.input, queries: ["unrelated narrower query"] }),
    ],
    [first, page(["c"], { ...last.input, categories: ["article"] })],
    [page(["a", "b", "c"], { ...filters, phases: [3] })],
    [page(["a", "b", "c"], { phases: [2] })],
  ]) {
    assert.deepEqual(
      observedContentFacts(
        "wiki-04",
        [context, exploratory, ...incomplete],
        new Set()
      ).evidence,
      [],
      JSON.stringify(incomplete)
    );
  }
});
test("unobserved content produces no facts; synthetic IDs isolate repetitions", () => {
  for (const id of contentFixtureIds)
    assert.deepEqual(observedContentFacts(id, [], new Set()), {
      facts: {},
      evidence: [],
    });
  const a = createFixtureManifest("wiki-04", 0),
    b = createFixtureManifest("wiki-04", 1);
  assert.equal(
    contentId(a, "article"),
    contentId(createFixtureManifest("wiki-04", 0), "article")
  );
  assert.notEqual(contentId(a, "article"), contentId(b, "article"));
});
test("email counts require distinct recipients, sent dates, both windows and email channel", () => {
  const calls = [contentWindows.month, contentWindows.previousMonth].map(
    (window, index) => ({
      id: String(index),
      name: "communication.query",
      input: {
        query: {
          resource: "distinct_recipients",
          timeField: "sent",
          channel: "email",
          window,
        },
      },
      output: {
        kind: "read",
        counts: { matched: 2 },
        items: [],
      },
    })
  );
  const presented = new Set(["0", "1"]);
  assert.deepEqual(observedContentFacts("communication-07", calls, presented), {
    facts: { thisMonthPeople: 2, lastMonthPeople: 2 },
    evidence: ["distinct-email-months"],
  });
  assert.deepEqual(
    observedContentFacts("communication-07", calls, new Set()),
    observedContentFacts("communication-07", calls, presented)
  );
  for (const patch of [
    { resource: "messages" },
    { timeField: "created" },
    { channel: "sms" },
  ])
    assert.deepEqual(
      observedContentFacts(
        "communication-07",
        calls.map((c) => ({
          ...c,
          input: { query: { ...c.input.query, ...patch } },
        })),
        presented
      ).evidence,
      []
    );
});
test("email comparison accepts exact month-to-date and rejects truncated exclusive month boundaries", () => {
  const makeCall = (id: string, window: { from: string; until: string }) => ({
    id,
    name: "communication.query",
    input: {
      query: {
        resource: "distinct_recipients",
        timeField: "sent",
        channel: "email",
        window,
      },
    },
    output: { kind: "read", counts: { matched: 2 }, items: [] },
  });
  const current = makeCall("current", contentWindows.monthToDate);
  const previous = makeCall("previous", contentWindows.previousMonth);
  assert.deepEqual(
    observedContentFacts("communication-07", [current, previous], new Set())
      .evidence,
    ["distinct-email-months"]
  );
  for (const until of ["2026-08-31T23:59:59-04:00", "2026-09-01T00:00:00Z"])
    assert.deepEqual(
      observedContentFacts(
        "communication-07",
        [
          current,
          makeCall("short", { ...contentWindows.previousMonth, until }),
        ],
        new Set()
      ).evidence,
      []
    );
  for (const until of [
    "2026-09-20T23:59:59-04:00",
    "2026-09-10T00:00:00-04:00",
  ])
    assert.deepEqual(
      observedContentFacts(
        "communication-07",
        [makeCall("arbitrary", { ...contentWindows.month, until }), previous],
        new Set()
      ).evidence,
      []
    );
});
test("one retrieved page is not a complete document or notification population", () => {
  for (const [id, name] of [
    ["documents-02", "documents.query"],
    ["notifications-02", "notifications.query"],
  ])
    assert.deepEqual(
      observedContentFacts(
        id,
        [
          {
            id: "one",
            name,
            input: { query: { resource: "generated" } },
            output: {
              kind: "read",
              counts: { matched: 2 },
              items: [{ id: "record", label: "One" }],
            },
          },
        ],
        new Set(["one"])
      ).evidence,
      []
    );
});
test("assessment IDs without stored evidence cannot satisfy a comparison", () => {
  const calls = [
    {
      id: "one",
      name: "intelligence.query",
      input: { query: { resource: "assessments" } },
      output: {
        kind: "read",
        counts: { matched: 3 },
        items: [
          { id: "a", label: "Assessment" },
          { id: "b", label: "Assessment" },
        ],
      },
    },
  ];
  const observed = observedContentFacts(
    "intelligence-04",
    calls,
    new Set(["one"])
  );
  assert.deepEqual(observed.facts.assessmentIds, ["a", "b"]);
  assert.deepEqual(observed.facts.snapshotPeople, []);
  assert.deepEqual(observed.evidence, []);
});

test("stored-report evidence is equal for text-only and card answers", () => {
  const calls = [
    {
      id: "reports",
      name: "intelligence.query",
      input: { query: { resource: "assessments" } },
      output: {
        kind: "read",
        counts: { matched: 3 },
        items: ["a", "b"].map((id, index) => ({
          id,
          label: "Stored assessment",
          facts: [
            { label: "Generated at", value: `September ${10 + index}, 2026` },
            { label: "Rubric version", value: `v${index + 1}` },
            {
              label: "Fact snapshot",
              value: JSON.stringify({ corePeople: 4 + index }),
            },
          ],
        })),
      },
    },
  ];
  const textOnly = observedContentFacts("intelligence-04", calls, new Set());
  assert.deepEqual(
    textOnly,
    observedContentFacts("intelligence-04", calls, new Set(["reports"]))
  );
  assert.deepEqual(textOnly.evidence, ["dated-stored-assessment-evidence"]);
  assert.deepEqual(textOnly.facts.snapshotPeople, ["a:4", "b:5"]);
});

test("stored report discovery and exact-ID rereads reconcile evidence without duplicate facts", () => {
  const items = ["a", "b"].map((id, index) => ({
    id,
    label: "Stored assessment",
    facts: [
      { label: "Generated at", value: `September ${10 + index}, 2026` },
      { label: "Rubric version", value: `v${index + 1}` },
      {
        label: "Fact snapshot",
        value: JSON.stringify({ corePeople: 4 + index }),
      },
    ],
  }));
  const discovery = {
    id: "discovery",
    name: "intelligence.query",
    input: {
      query: {
        resource: "assessments",
        limit: 2,
        offset: 0,
        includeFactSnapshot: true,
      },
    },
    output: { kind: "read", counts: { matched: 3 }, items },
  };
  const exact = {
    ...structuredClone(discovery),
    id: "exact",
    input: { query: { ...discovery.input.query, assessmentIds: ["a", "b"] } },
    output: { ...structuredClone(discovery.output), counts: { matched: 2 } },
  };
  const observe = (calls: (typeof discovery)[]) =>
    observedContentFacts("intelligence-04", calls, new Set());
  const single = observe([discovery]);
  assert.deepEqual(observe([discovery, exact]), single);
  assert.deepEqual(single.facts, {
    assessmentIds: ["a", "b"],
    rubricVersions: ["a:v1", "b:v2"],
    snapshotPeople: ["a:4", "b:5"],
  });
  assert.deepEqual(single.evidence, ["dated-stored-assessment-evidence"]);
  const shallow = structuredClone(discovery);
  shallow.output.items.forEach((item) => {
    item.facts = item.facts.filter((f) => f.label !== "Fact snapshot");
  });
  assert.deepEqual(observe([shallow, exact]), single);
  assert.deepEqual(observe([shallow]).evidence, []);
  for (const [label, value] of [
    ["Generated at", "September 12, 2026"],
    ["Rubric version", "v3"],
    ["Fact snapshot", '{"corePeople":99}'],
    ["Fact snapshot", "malformed JSON"],
  ]) {
    const conflict = structuredClone(exact);
    conflict.output.items[0].facts.find((f) => f.label === label)!.value =
      value;
    assert.deepEqual(observe([discovery, conflict]).evidence, [], label);
    assert.deepEqual(
      observe([conflict, discovery]).evidence,
      [],
      `${label} reverse order`
    );
  }
  const one = structuredClone(discovery);
  one.output.items = one.output.items.slice(0, 1);
  assert.deepEqual(observe([one, one]).evidence, []);
});
