// ============================================================================
// Trends — DOM-level tests (PE-026 + PE-027 badges).
//
// The projection tests (lib/phase-engine/signals/queries.test.ts) pin what the
// read layer PRODUCES. These pin what a browser actually RECEIVES, because
// several of this unit's acceptance criteria are assertions about the rendered
// surface rather than about the projection behind it:
//
//   - all four trends render, each with its value,
//   - a plant with ONE data point shows the value and draws no trend line,
//   - a metric no snapshot answered shows "no reading", never a zero,
//   - the alert badge carries the persisted severity it was mapped from, and
//     the same number under two different severities badges differently — the
//     proof that the badge is not a threshold applied to the value.
//
// `renderToStaticMarkup` gives the exact markup the browser is served, so
// asserting on it is a real assertion about the DOM — no jsdom needed for a
// server component with no client behaviour. Same approach as
// components/phase-engine/exit-criteria.test.ts.
//
// The fixture is a hand-built `PlantTrends` rather than one projected from
// stored snapshots: this file is about the rendering contract, and building the
// input by hand keeps it from importing `queries.ts` (which constructs the Neon
// client at import time) for a test that touches no data layer.
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  EngineAlert,
  PlantTrends,
  TrendMetric,
} from "@/lib/phase-engine/signals/queries";

import { Trends } from "./trends";

// ----------------------------------------------------------------------------
// A tiny markup reader.
// ----------------------------------------------------------------------------

/** The markup of each tile, in document order. */
function tiles(html: string): string[] {
  return html.split('<li data-testid="trend-metric" ').slice(1);
}

/** The first value of `name="…"` in a chunk. */
function attr(chunk: string, name: string): string | null {
  const match = chunk.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : null;
}

/** Tags stripped, entities decoded enough to read copy back. */
function text(chunk: string): string {
  return chunk
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&middot;/g, "·")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function render(trends: PlantTrends | null): string {
  return renderToStaticMarkup(createElement(Trends, { trends }));
}

// ----------------------------------------------------------------------------
// Fixtures.
// ----------------------------------------------------------------------------

const NOT_RAISED: EngineAlert = {
  standing: "not_raised",
  severity: null,
  insightId: null,
  insightTitle: null,
  insightCount: 0,
};

function points(values: number[], startIso = "2026-05-01T00:00:00.000Z") {
  const start = new Date(startIso).getTime();
  const week = 7 * 24 * 60 * 60 * 1000;
  return values.map((value, index) => ({
    at: new Date(start + index * week),
    value,
  }));
}

function trendMetric(overrides: Partial<TrendMetric> = {}): TrendMetric {
  const base: TrendMetric = {
    key: "core_group_growth",
    label: "Core group",
    description: "People with a signed core-group commitment.",
    unit: "count",
    higherIsBetter: true,
    value: 17,
    valueAt: new Date("2026-05-15T00:00:00.000Z"),
    valueIsStale: false,
    reading: null,
    points: points([8, 12, 17]),
    delta: 9,
    direction: "up",
    since: new Date("2026-05-01T00:00:00.000Z"),
    factPaths: ["coreGroup.committedCount"],
    alert: NOT_RAISED,
  };
  return { ...base, ...overrides };
}

function plantTrends(metrics: TrendMetric[], hasHistory = true): PlantTrends {
  return {
    metrics,
    snapshotCount: hasHistory ? 3 : 1,
    asOf: new Date("2026-06-01T00:00:00.000Z"),
    since: new Date("2026-05-01T00:00:00.000Z"),
    hasHistory,
    audience: "planter",
  };
}

/** The four metrics, as the read layer emits them. */
function fourMetrics(): TrendMetric[] {
  return [
    trendMetric(),
    trendMetric({
      key: "meeting_attendance",
      label: "Vision meeting attendance",
      value: 24,
      points: points([30, 27, 24]),
      delta: -6,
      direction: "down",
      factPaths: ["visionMeetings.latestAttendance"],
    }),
    trendMetric({
      key: "follow_up_completion",
      label: "Follow-up completion",
      unit: "rate",
      value: 0.8,
      reading: "8 of 10 open contacts touched within 14 days",
      points: points([0.6, 0.7, 0.8]),
      delta: 0.2,
      direction: "up",
      factPaths: ["followUp.openCount", "followUp.staleCount"],
    }),
    trendMetric({
      key: "team_readiness",
      label: "Ministry team readiness",
      unit: "rate",
      value: 0.625,
      reading: "5 of 8 roles have a leader",
      points: points([0.375, 0.5, 0.625]),
      delta: 0.25,
      direction: "up",
      factPaths: ["ministryRoles.filledCount", "ministryRoles.totalRoles"],
    }),
  ];
}

// ----------------------------------------------------------------------------
// All four trends render.
// ----------------------------------------------------------------------------

test("renders all four trends, in the read layer's order", () => {
  const html = render(plantTrends(fourMetrics()));
  const rendered = tiles(html);

  assert.equal(rendered.length, 4);
  assert.deepEqual(
    rendered.map((tile) => attr(tile, "data-metric")),
    [
      "core_group_growth",
      "meeting_attendance",
      "follow_up_completion",
      "team_readiness",
    ]
  );
});

test("a count renders as itself and a rate as a whole percent", () => {
  const rendered = tiles(render(plantTrends(fourMetrics())));

  assert.match(text(rendered[0]), /\b17\b/);
  assert.match(text(rendered[1]), /\b24\b/);
  assert.match(text(rendered[2]), /80%/);
  assert.match(text(rendered[3]), /63%/);
});

test("the counts behind a ratio are spelled out", () => {
  const rendered = tiles(render(plantTrends(fourMetrics())));

  assert.match(text(rendered[3]), /5 of 8 roles have a leader/);
});

test("a change is signed, dated, and a rate's change is in points", () => {
  const rendered = tiles(render(plantTrends(fourMetrics())));

  assert.match(text(rendered[0]), /\+9 since May 1/);
  assert.match(text(rendered[1]), /−6 since May 1/);
  // "+20 pts" and "+20%" are different numbers; a rate's delta is points.
  assert.match(text(rendered[2]), /\+20 pts since May 1/);
});

// ----------------------------------------------------------------------------
// Sparse plants — the one-data-point criterion.
// ----------------------------------------------------------------------------

test("one data point shows the value and draws no trend line", () => {
  const single = trendMetric({
    value: 12,
    points: points([12]),
    delta: null,
    direction: null,
    since: null,
  });
  const rendered = tiles(render(plantTrends([single], false)));

  assert.equal(rendered.length, 1);
  assert.equal(attr(rendered[0], "data-has-trend"), "false");
  assert.equal(
    rendered[0].includes('data-testid="trend-sparkline"'),
    false,
    "a line was drawn through a single reading"
  );
  assert.match(text(rendered[0]), /\b12\b/);
  assert.match(text(rendered[0]), /nothing to compare it to yet/);
  assert.equal(text(rendered[0]).includes("since"), false);
});

test("the card says so too when there is only one assessment", () => {
  const html = render(plantTrends([trendMetric()], false));

  assert.match(text(html), /nothing here is a trend yet/);
});

test("two or more readings do draw a line", () => {
  const rendered = tiles(render(plantTrends(fourMetrics())));

  assert.ok(rendered[0].includes('data-testid="trend-sparkline"'));
  assert.equal(attr(rendered[0], "data-has-trend"), "true");
  assert.equal(attr(rendered[0], "data-points"), "3");
  // One series, so the mark is ink rather than a categorical hue, and the end
  // marker carries a surface ring so it stays legible over the line.
  assert.match(rendered[0], /stroke-foreground\/35/);
  assert.match(rendered[0], /fill-foreground stroke-card/);
});

test("an unanswered metric reads as no reading, never as zero", () => {
  const missing = trendMetric({
    value: null,
    points: [],
    delta: null,
    direction: null,
    since: null,
  });
  const rendered = tiles(render(plantTrends([missing])));

  assert.match(text(rendered[0]), /—/);
  assert.equal(text(rendered[0]).includes(" 0 "), false);
  assert.ok(rendered[0].includes('data-testid="trend-no-reading"'));
  assert.equal(rendered[0].includes('data-testid="trend-sparkline"'), false);
});

test("a reading older than the card's as-of date says which day it is from", () => {
  // The read layer sets `valueIsStale` when the newest snapshot could not answer
  // the metric — a plant that clears its follow-up queue keeps an earlier rate.
  // The card's header carries ONE date (the newest snapshot's), so the tile has
  // to date its own number or the header speaks for a reading it did not make.
  const stale = trendMetric({
    key: "follow_up_completion",
    label: "Follow-up completion",
    unit: "rate",
    value: 0.8,
    valueAt: new Date("2026-05-15T00:00:00.000Z"),
    valueIsStale: true,
    reading: null,
    points: points([0.6, 0.8]),
    delta: 0.2,
    direction: "up",
  });
  const rendered = tiles(render(plantTrends([stale])));

  assert.equal(attr(rendered[0], "data-stale"), "true");
  assert.ok(rendered[0].includes('data-testid="trend-stale-reading"'));
  assert.match(text(rendered[0]), /Measured May 15/);
  assert.match(text(rendered[0]), /no reading for this one/);
});

test("a current reading is not dated twice", () => {
  const rendered = tiles(render(plantTrends(fourMetrics())));

  for (const tile of rendered) {
    assert.equal(attr(tile, "data-stale"), "false");
    assert.equal(tile.includes('data-testid="trend-stale-reading"'), false);
  }
});

// ----------------------------------------------------------------------------
// Alert badges — mapped from the persisted severity.
// ----------------------------------------------------------------------------

test("the badge carries the persisted severity it was mapped from", () => {
  const raised = trendMetric({
    alert: {
      standing: "attention",
      severity: "critical",
      insightId: "insight-1",
      insightTitle: "Core group has stalled",
      insightCount: 2,
    },
  });
  const rendered = tiles(render(plantTrends([raised])));

  assert.equal(attr(rendered[0], "data-standing"), "attention");
  const badge = rendered[0].split('data-slot="trend-alert"')[1];
  assert.ok(badge);
  assert.equal(attr(badge, "data-severity"), "critical");
  assert.equal(attr(badge, "data-insight-id"), "insight-1");
  assert.match(text(badge), /Needs attention/);
});

test("the same value under two severities badges differently", () => {
  // No threshold exists in this component: the value is identical in both
  // renders and only the persisted severity moves the badge.
  const value = 17;
  const attention = tiles(
    render(
      plantTrends([
        trendMetric({
          value,
          alert: {
            standing: "attention",
            severity: "high",
            insightId: "a",
            insightTitle: "t",
            insightCount: 1,
          },
        }),
      ])
    )
  )[0];
  const strength = tiles(
    render(
      plantTrends([
        trendMetric({
          value,
          alert: {
            standing: "strength",
            severity: "info",
            insightId: "b",
            insightTitle: "t",
            insightCount: 1,
          },
        }),
      ])
    )
  )[0];

  assert.equal(attr(attention, "data-standing"), "attention");
  assert.equal(attr(strength, "data-standing"), "strength");
  assert.match(text(attention), /Needs attention/);
  assert.match(text(strength), /Going well/);
});

test("a metric the assessment did not speak to reads not raised", () => {
  const rendered = tiles(render(plantTrends([trendMetric()])));

  assert.equal(attr(rendered[0], "data-standing"), "not_raised");
  assert.match(text(rendered[0]), /Not raised/);
});

// ----------------------------------------------------------------------------
// Cold start.
// ----------------------------------------------------------------------------

test("a never-assessed plant renders no tiles at all", () => {
  const html = render(null);

  assert.equal(tiles(html).length, 0);
  assert.match(text(html), /hasn't been assessed yet/);
});
