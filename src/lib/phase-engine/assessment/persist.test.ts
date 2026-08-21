import assert from "node:assert/strict";
import { test } from "node:test";

import type { Insight } from "@/lib/phase-engine/judge";
import type { RetrievedPassage } from "@/lib/phase-engine/rag";
import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";

import {
  buildInsightRows,
  computeSnapshotDelta,
  filterInsightsForPersistence,
  isIndividualPersonFinding,
  mapSeverity,
  reconcileArticleSlugs,
} from "./persist";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    audience: "planter",
    category: "phase_progress",
    severity: "info",
    title: "A finding",
    body: "Observation plus a recommended next step.",
    citedFacts: ["coreGroup.committedCount=10"],
    relatedArticleSlugs: [],
    ...overrides,
  };
}

function makePassage(
  articleSlug: string | null,
  overrides: Partial<RetrievedPassage> = {}
): RetrievedPassage {
  return {
    docKey: articleSlug ?? "playbook:section",
    articleSlug,
    source: articleSlug ? "wiki" : "playbook",
    section: "A heading",
    phase: 1,
    content: "Methodology passage text.",
    score: 0.5,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<PlantFactSnapshot> = {}
): PlantFactSnapshot {
  return {
    snapshotVersion: "1.0.0",
    churchId: "church-123",
    currentPhase: 1,
    generatedAt: "2026-06-22T12:00:00.000Z",
    isColdStart: false,
    coreGroup: {
      committedCount: 10,
      launchTeamCount: 4,
      growthDelta: null,
      growthWindowDays: 30,
      daysSinceLastNewCommitment: 30,
      slowedThresholdDays: 21,
      stalledThresholdDays: 28,
      isEmpty: false,
    },
    visionMeetings: {
      totalCompleted: 3,
      lastMeetingAt: "2026-06-01",
      daysSinceLastMeeting: 21,
      averageCadenceDays: 14,
      latestAttendance: 25,
      previousAttendance: 20,
      attendanceTrend: "up",
      isEmpty: false,
    },
    followUp: {
      openCount: 5,
      stalestDays: 9,
      staleCount: 1,
      staleThresholdDays: 7,
      unownedCount: 0,
      staleUnownedCount: 0,
      distinctOwnerCount: 0,
      planterOwnedCount: 0,
      isEmpty: false,
    },
    ministryRoles: { filledCount: 3, totalRoles: 8, roles: [], isEmpty: false },
    leadership: { candidates: [], isEmpty: true },
    training: {
      programCount: 2,
      requiredProgramCount: 1,
      completionCount: 6,
      requiredCompletionRate: 0.5,
      isEmpty: false,
    },
    launch: {
      launchDate: "2026-12-01",
      daysUntilLaunch: 162,
      isPastDue: false,
      isEmpty: false,
    },
    manual: {
      attestations: [],
      byKey: {},
      reaffirmWindowDays: 30,
      isEmpty: true,
    },
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Severity mapping (documented judge → DB enum mapping).
// ----------------------------------------------------------------------------

test("mapSeverity maps judge enum onto the DB enum as documented", () => {
  assert.equal(mapSeverity("positive"), "info");
  assert.equal(mapSeverity("info"), "low");
  assert.equal(mapSeverity("watch"), "medium");
  assert.equal(mapSeverity("urgent"), "high");
});

// ----------------------------------------------------------------------------
// Privacy filtering (PE-012/013).
// ----------------------------------------------------------------------------

test("planter insights are always kept, even when naming an individual", () => {
  const insights: Insight[] = [
    makeInsight({
      audience: "planter",
      citedFacts: ["leadership.candidates[0].personId=abc"],
    }),
  ];
  assert.equal(filterInsightsForPersistence(insights).length, 1);
});

test("network insights citing an individual person are dropped", () => {
  const indiv = makeInsight({
    audience: "network",
    citedFacts: ["leadership.candidates[1].personId=xyz"],
  });
  assert.equal(isIndividualPersonFinding(indiv), true);

  const kept = filterInsightsForPersistence([indiv]);
  assert.equal(kept.length, 0);
});

test("network insights over aggregate facts are kept", () => {
  const agg = makeInsight({
    audience: "network",
    citedFacts: ["coreGroup.committedCount=10"],
  });
  assert.equal(isIndividualPersonFinding(agg), false);
  assert.equal(filterInsightsForPersistence([agg]).length, 1);
});

test("mixed batch: keeps both planter insights and aggregate network insights", () => {
  const insights: Insight[] = [
    makeInsight({ audience: "planter" }),
    makeInsight({
      audience: "network",
      citedFacts: ["personId=leak"],
    }),
    makeInsight({
      audience: "network",
      citedFacts: ["visionMeetings.totalCompleted=3"],
    }),
  ];
  const kept = filterInsightsForPersistence(insights);
  assert.equal(kept.length, 2);
  assert.equal(
    kept.some((i) => i.citedFacts.includes("personId=leak")),
    false
  );
});

// ----------------------------------------------------------------------------
// Ranking + row mapping.
// ----------------------------------------------------------------------------

test("buildInsightRows orders by urgency and assigns 0-based ranks", () => {
  const insights: Insight[] = [
    makeInsight({ title: "info", severity: "info" }),
    makeInsight({ title: "urgent", severity: "urgent" }),
    makeInsight({ title: "watch", severity: "watch" }),
  ];
  const rows = buildInsightRows("assessment-1", "church-1", insights);
  assert.deepEqual(
    rows.map((r) => r.title),
    ["urgent", "watch", "info"]
  );
  assert.deepEqual(
    rows.map((r) => r.rank),
    [0, 1, 2]
  );
  // Severity is mapped to the DB enum on the row.
  assert.equal(rows[0].severity, "high");
});

test("buildInsightRows applies privacy filtering before ranking", () => {
  const insights: Insight[] = [
    makeInsight({
      audience: "network",
      severity: "urgent",
      citedFacts: ["leadership.candidates[0].personId=x"],
    }),
    makeInsight({ audience: "planter", severity: "info" }),
  ];
  const rows = buildInsightRows("a", "c", insights);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].audience, "planter");
});

// ----------------------------------------------------------------------------
// "How to improve" wiki links (PE-024) — a persisted link must point at
// methodology the engine ACTUALLY retrieved, not a slug the model invented.
// ----------------------------------------------------------------------------

test("reconcileArticleSlugs keeps only slugs carried by a retrieved passage", () => {
  const passages = [
    makePassage("core-group/what-is-a-vision-meeting"),
    makePassage("core-group/building-momentum"),
  ];

  assert.deepEqual(
    reconcileArticleSlugs(
      ["core-group/what-is-a-vision-meeting", "invented/never-retrieved"],
      passages
    ),
    ["core-group/what-is-a-vision-meeting"]
  );
});

test("reconcileArticleSlugs drops every slug when retrieval returned nothing", () => {
  assert.deepEqual(reconcileArticleSlugs(["core-group/anything"], []), []);
});

test("reconcileArticleSlugs ignores passages with no article slug (playbook chunks)", () => {
  const passages = [makePassage(null, { docKey: "playbook:core-group" })];
  assert.deepEqual(
    reconcileArticleSlugs(["playbook:core-group"], passages),
    []
  );
});

test("reconcileArticleSlugs normalizes casing/slashes and persists the corpus spelling", () => {
  const passages = [makePassage("core-group/vision-meetings")];

  assert.deepEqual(
    reconcileArticleSlugs(["/Core-Group/Vision-Meetings/"], passages),
    ["core-group/vision-meetings"]
  );
});

test("reconcileArticleSlugs dedupes repeated citations and preserves judge order", () => {
  const passages = [makePassage("b-article"), makePassage("a-article")];

  assert.deepEqual(
    reconcileArticleSlugs(["a-article", "b-article", "a-article"], passages),
    ["a-article", "b-article"]
  );
});

test("reconcileArticleSlugs handles an empty/absent citation list", () => {
  assert.deepEqual(reconcileArticleSlugs([], [makePassage("a")]), []);
  assert.deepEqual(reconcileArticleSlugs(null, [makePassage("a")]), []);
  assert.deepEqual(reconcileArticleSlugs(undefined, [makePassage("a")]), []);
});

test("buildInsightRows persists the slug the retrieved chunk's metadata carried", () => {
  const retrieved = makePassage("core-group/what-is-a-vision-meeting");
  const insights: Insight[] = [
    makeInsight({
      severity: "urgent",
      title: "Vision meeting cadence has slipped",
      relatedArticleSlugs: [
        "core-group/what-is-a-vision-meeting",
        "hallucinated/article",
      ],
    }),
  ];

  const rows = buildInsightRows("assessment-1", "church-1", insights, [
    retrieved,
  ]);

  // The stored link is exactly the retrieved chunk's articleSlug metadata.
  assert.deepEqual(rows[0].relatedArticleSlugs, [retrieved.articleSlug]);
});

test("buildInsightRows stores no links when the run had no retrieval provenance", () => {
  const insights: Insight[] = [
    makeInsight({ relatedArticleSlugs: ["core-group/anything"] }),
  ];

  // No passages argument at all (e.g. retrieval failed and degraded to []).
  const rows = buildInsightRows("assessment-1", "church-1", insights);
  assert.deepEqual(rows[0].relatedArticleSlugs, []);
});

// ----------------------------------------------------------------------------
// What-changed delta (PE-016).
// ----------------------------------------------------------------------------

test("first assessment has no prior snapshot to diff", () => {
  const delta = computeSnapshotDelta(null, makeSnapshot());
  assert.equal(delta.isFirstAssessment, true);
  assert.deepEqual(delta.changed, []);
});

test("delta reports only fields that moved, with signed deltas", () => {
  const prev = makeSnapshot();
  const curr = makeSnapshot({
    coreGroup: { ...prev.coreGroup, committedCount: 13 },
    visionMeetings: { ...prev.visionMeetings, latestAttendance: 20 },
  });

  const delta = computeSnapshotDelta(prev, curr);
  assert.equal(delta.isFirstAssessment, false);

  const byPath = new Map(delta.changed.map((c) => [c.path, c]));
  assert.deepEqual(byPath.get("coreGroup.committedCount"), {
    path: "coreGroup.committedCount",
    previous: 10,
    current: 13,
    delta: 3,
  });
  assert.deepEqual(byPath.get("visionMeetings.latestAttendance"), {
    path: "visionMeetings.latestAttendance",
    previous: 25,
    current: 20,
    delta: -5,
  });
  // Unchanged facts are absent.
  assert.equal(byPath.has("followUp.openCount"), false);
});

test("delta handles a null → number transition with delta=null", () => {
  const prev = makeSnapshot({
    launch: {
      launchDate: null,
      daysUntilLaunch: null,
      isPastDue: false,
      isEmpty: true,
    },
  });
  const curr = makeSnapshot({
    launch: {
      launchDate: "2026-12-01",
      daysUntilLaunch: 100,
      isPastDue: false,
      isEmpty: false,
    },
  });
  const delta = computeSnapshotDelta(prev, curr);
  const field = delta.changed.find((c) => c.path === "launch.daysUntilLaunch");
  assert.ok(field);
  assert.equal(field.previous, null);
  assert.equal(field.current, 100);
  assert.equal(field.delta, null);
});
