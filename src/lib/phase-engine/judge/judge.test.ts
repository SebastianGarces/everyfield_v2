import assert from "node:assert/strict";
import { test } from "node:test";

import { makeSnapshot } from "@/lib/phase-engine/signals/testing";
import type { RetrievedPassage } from "@/lib/phase-engine/rag";
import {
  ACTIVE_RUBRIC,
  ACTIVE_RUBRIC_VERSION,
  RUBRICS,
  getRubric,
} from "@/lib/phase-engine/rubric";
import { insightSchema, hasBothAudiences, type Insight } from "./schema";
import { FIXTURE_JUDGE_SCHEMA } from "./testing";

/** The fixture plant's schema — this suite is not about the evidence rule. */
const judgeOutputSchema = FIXTURE_JUDGE_SCHEMA;

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

test("judgeOutputSchema requires a summary and an insight for each audience", () => {
  assert.throws(() =>
    judgeOutputSchema.parse({ summary: "ok and grounded", insights: [] })
  );
  // One insight is no longer enough: audience coverage (PE-012) became a
  // refinement on this schema in #605, so a one-sided assessment is refused
  // here — and therefore RETRIED — rather than thrown out after the parse.
  assert.throws(() =>
    judgeOutputSchema.parse({
      summary: "Plant is tracking to plan with steady core-group growth.",
      insights: [validInsight({ audience: "planter" })],
    })
  );
  const parsed = judgeOutputSchema.parse({
    summary: "Plant is tracking to plan with steady core-group growth.",
    insights: [
      validInsight({ audience: "planter" }),
      validInsight({ audience: "network", severity: "positive" }),
    ],
  });
  assert.equal(parsed.insights.length, 2);
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
  // Version is referenced (AC-PE-4 audit linkage). Read from the constant, not
  // typed in: what this asserts is that the ACTIVE version reaches the prompt,
  // and a literal would fail on every flip while proving nothing more.
  assert.ok(prompt.includes(`version ${ACTIVE_RUBRIC_VERSION}`));
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
