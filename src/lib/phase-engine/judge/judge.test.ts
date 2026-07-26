import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";
import type { RetrievedPassage } from "@/lib/phase-engine/rag";
import {
  ACTIVE_RUBRIC,
  ACTIVE_RUBRIC_VERSION,
  RUBRICS,
  getRubric,
} from "@/lib/phase-engine/rubric";
import {
  insightSchema,
  judgeOutputSchema,
  hasBothAudiences,
  type Insight,
} from "./schema";
import {
  flattenFacts,
  buildSystemPrompt,
  buildUserPrompt,
  buildRetrievalQuery,
} from "./prompt";

// ----------------------------------------------------------------------------
// These tests pin the pure, deterministic core of the judge: the Zod insight
// schema and the prompt/rubric helpers. No live LLM calls are made — the
// generateObject pipeline is integration-tested separately against the real
// provider.
// ----------------------------------------------------------------------------

// A minimal but complete snapshot fixture. Mirrors the PlantFactSnapshot
// contract from the signal layer.
function makeSnapshot(
  overrides: Partial<PlantFactSnapshot> = {}
): PlantFactSnapshot {
  return {
    snapshotVersion: "1.0.0",
    churchId: "church-123",
    currentPhase: 1,
    generatedAt: "2026-06-22T00:00:00.000Z",
    isColdStart: false,
    coreGroup: {
      committedCount: 22,
      launchTeamCount: 0,
      growthDelta: 2,
      growthWindowDays: 7,
      isEmpty: false,
    },
    visionMeetings: {
      totalCompleted: 4,
      lastMeetingAt: "2026-06-01",
      daysSinceLastMeeting: 21,
      averageCadenceDays: 14,
      latestAttendance: 30,
      previousAttendance: 30,
      attendanceTrend: "flat",
      isEmpty: false,
    },
    followUp: {
      openCount: 10,
      stalestDays: 20,
      staleCount: 7,
      staleThresholdDays: 14,
      isEmpty: false,
    },
    ministryRoles: {
      filledCount: 2,
      totalRoles: 8,
      roles: [
        { key: "worship", label: "Worship", teamPresent: false, filled: false },
        {
          key: "childrens",
          label: "Children's",
          teamPresent: true,
          filled: true,
        },
      ],
      isEmpty: false,
    },
    leadership: {
      candidates: [
        {
          personId: "p-1",
          status: "core_group",
          tenureDays: 70,
          meetingsAttended: 6,
          activeMemberships: 1,
          hasCommitment: true,
          leadsTeam: false,
        },
      ],
      isEmpty: false,
    },
    training: {
      programCount: 0,
      requiredProgramCount: 0,
      completionCount: 0,
      requiredCompletionRate: null,
      isEmpty: true,
    },
    launch: {
      launchDate: "2026-10-12",
      daysUntilLaunch: 112,
      isPastDue: false,
      isEmpty: false,
    },
    manual: {
      attestations: [],
      byKey: {},
      isEmpty: true,
    },
    ...overrides,
  };
}

function validInsight(over: Partial<Insight> = {}): Insight {
  return {
    audience: "planter",
    category: "vision_casting",
    severity: "watch",
    title: "Vision meeting cadence is slipping",
    body: "It has been 21 days since your last vision meeting; cadence target is every 2 weeks.",
    citedFacts: ["visionMeetings.daysSinceLastMeeting=21"],
    relatedArticleSlugs: ["what-is-a-vision-meeting"],
    ...over,
  };
}

// --- Schema -----------------------------------------------------------------

test("insightSchema accepts a well-formed insight", () => {
  const parsed = insightSchema.parse(validInsight());
  assert.equal(parsed.audience, "planter");
  assert.equal(parsed.category, "vision_casting");
  assert.deepEqual(parsed.citedFacts, [
    "visionMeetings.daysSinceLastMeeting=21",
  ]);
});

test("insightSchema requires at least one cited fact (NFR-PE-1 grounding)", () => {
  assert.throws(() => insightSchema.parse(validInsight({ citedFacts: [] })));
});

test("insightSchema rejects an unknown audience", () => {
  assert.throws(() =>
    // @ts-expect-error — invalid audience on purpose
    insightSchema.parse(validInsight({ audience: "investor" }))
  );
});

test("insightSchema rejects an unknown category", () => {
  assert.throws(() =>
    // @ts-expect-error — invalid category on purpose
    insightSchema.parse(validInsight({ category: "vibes" }))
  );
});

test("relatedArticleSlugs is required (OpenAI strict mode) but may be empty", () => {
  // Omitting it fails: every property must be in `required` for strict
  // structured output, so the model must always emit the key.
  const { relatedArticleSlugs, ...rest } = validInsight();
  void relatedArticleSlugs;
  assert.throws(() => insightSchema.parse(rest));
  // An explicit empty array is valid (no relevant passage).
  const parsed = insightSchema.parse(validInsight({ relatedArticleSlugs: [] }));
  assert.deepEqual(parsed.relatedArticleSlugs, []);
});

test("judgeOutputSchema requires a summary and at least one insight", () => {
  assert.throws(() =>
    judgeOutputSchema.parse({ summary: "ok and grounded", insights: [] })
  );
  const parsed = judgeOutputSchema.parse({
    summary: "Plant is tracking to plan with steady core-group growth.",
    insights: [validInsight()],
  });
  assert.equal(parsed.insights.length, 1);
});

// --- Audience coverage helper (PE-012) --------------------------------------

test("hasBothAudiences is true only when planter AND network are present", () => {
  assert.equal(
    hasBothAudiences([validInsight({ audience: "planter" })]),
    false
  );
  assert.equal(
    hasBothAudiences([validInsight({ audience: "network" })]),
    false
  );
  assert.equal(
    hasBothAudiences([
      validInsight({ audience: "planter" }),
      validInsight({ audience: "network" }),
    ]),
    true
  );
});

// --- Rubric (PE-006 / AC-PE-4) ----------------------------------------------

test("the active rubric is loaded whole and exposes a version string", () => {
  assert.equal(ACTIVE_RUBRIC.version, ACTIVE_RUBRIC_VERSION);
  assert.ok(
    ACTIVE_RUBRIC.body.length > 1000,
    "rubric body should be substantial"
  );
  // Part A (CSF lenses) and Part B (phase focus) are both present.
  assert.match(ACTIVE_RUBRIC.body, /CSF-1 · Vision Casting/);
  assert.match(ACTIVE_RUBRIC.body, /Phase 1 · Core Group Development/);
});

test("getRubric resolves a known version and is undefined otherwise", () => {
  assert.equal(getRubric("v0")?.version, "v0");
  assert.equal(getRubric("v999"), undefined);
});

test("every registered rubric is keyed by its own version", () => {
  for (const [key, rubric] of Object.entries(RUBRICS)) {
    assert.equal(key, rubric.version);
  }
});

// --- Prompt helpers (AC-PE-5 / NFR-PE-1) ------------------------------------

test("flattenFacts produces dotted key=value lines and handles nulls/arrays", () => {
  const lines = flattenFacts(makeSnapshot());
  const byKey = new Map(lines.map((l) => [l.key, l.value]));

  assert.equal(byKey.get("coreGroup.committedCount"), "22");
  assert.equal(byKey.get("launch.daysUntilLaunch"), "112");
  // Array elements are indexed.
  assert.equal(byKey.get("ministryRoles.roles.0.filled"), "false");
  assert.equal(byKey.get("ministryRoles.roles.1.key"), "childrens");
});

test("flattenFacts renders null facts explicitly as 'null'", () => {
  const snap = makeSnapshot({
    launch: {
      launchDate: null,
      daysUntilLaunch: null,
      isPastDue: false,
      isEmpty: true,
    },
  });
  const byKey = new Map(flattenFacts(snap).map((l) => [l.key, l.value]));
  assert.equal(byKey.get("launch.daysUntilLaunch"), "null");
});

test("flattenFacts is deterministic for identical input", () => {
  assert.deepEqual(flattenFacts(makeSnapshot()), flattenFacts(makeSnapshot()));
});

test("buildSystemPrompt embeds the whole rubric and the grounding constraints", () => {
  const prompt = buildSystemPrompt(ACTIVE_RUBRIC);
  // Whole rubric is embedded.
  assert.ok(prompt.includes(ACTIVE_RUBRIC.body));
  // Version is referenced (AC-PE-4 audit linkage).
  assert.match(prompt, /version v0/);
  // Hard constraints are present.
  assert.match(prompt, /NEVER invent/i);
  assert.match(prompt, /citedFacts/);
  assert.match(prompt, /planter/);
  assert.match(prompt, /network/);
});

test("buildUserPrompt renders the fact ledger and the methodology passages", () => {
  const passages: RetrievedPassage[] = [
    {
      docKey: "what-is-a-vision-meeting",
      articleSlug: "what-is-a-vision-meeting",
      source: "wiki",
      section: "What is a Vision Meeting?",
      phase: 1,
      content: "A vision meeting is the engine of core-group growth.",
      score: 1,
    },
  ];
  const prompt = buildUserPrompt(makeSnapshot(), passages);
  assert.match(prompt, /CURRENT PHASE: 1/);
  // Facts appear as key = value lines.
  assert.match(prompt, /coreGroup\.committedCount = 22/);
  // Passage slug is surfaced for citation.
  assert.match(prompt, /slug=what-is-a-vision-meeting/);
});

test("buildUserPrompt flags cold-start and tolerates zero passages", () => {
  const prompt = buildUserPrompt(makeSnapshot({ isColdStart: true }), []);
  assert.match(prompt, /COLD START/);
  assert.match(prompt, /no methodology passages retrieved/);
});

test("buildRetrievalQuery is phase-aware and need-driven", () => {
  const q = buildRetrievalQuery(makeSnapshot());
  assert.match(q, /phase 1/);
  // Has stale follow-up + unfilled roles + sub-50 core group in the fixture.
  assert.match(q, /follow up/i);
  assert.match(q, /ministry team/i);
  assert.match(q, /core group/i);
});

test("buildRetrievalQuery surfaces onboarding language at cold start", () => {
  const q = buildRetrievalQuery(makeSnapshot({ isColdStart: true }));
  assert.match(q, /onboarding|getting started/i);
});
