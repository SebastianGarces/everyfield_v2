// ============================================================================
// MilestoneTimeline — DOM-level tests (PE-027).
//
// The projection tests (lib/phase-engine/signals/queries.test.ts) pin which
// events the read layer produces. These pin what a browser receives:
//
//   - the key dates render as rows, in order, each with its date,
//   - the launch date renders when one is set, with its countdown,
//   - a plant with no launch date is told so and pointed at `/launch`,
//   - a row's badge is the persisted severity's standing, and a row the
//     assessment did not speak to wears no badge at all.
//
// `renderToStaticMarkup` gives the exact markup the browser is served. The
// fixture is hand-built for the same reason as the trends DOM tests: this file
// is about the rendering contract and must not import the data layer.
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  EngineAlert,
  MilestoneEvent,
  MilestoneTimeline as MilestoneTimelineData,
} from "@/lib/phase-engine/signals/queries";

import { MilestoneTimeline } from "./milestone-timeline";

// ----------------------------------------------------------------------------
// A tiny markup reader.
// ----------------------------------------------------------------------------

function rows(html: string): string[] {
  return html.split('<li data-testid="milestone-event" ').slice(1);
}

function attr(chunk: string, name: string): string | null {
  const match = chunk.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : null;
}

function text(chunk: string): string {
  return chunk
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function render(timeline: MilestoneTimelineData | null): string {
  return renderToStaticMarkup(createElement(MilestoneTimeline, { timeline }));
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

function event(overrides: Partial<MilestoneEvent> = {}): MilestoneEvent {
  return {
    id: "e1",
    kind: "phase_declared",
    at: new Date("2026-01-05T00:00:00.000Z"),
    label: "Started in Phase 2: Launch Team Formation",
    detail: "Where the plant stood when it joined EveryField.",
    state: "past",
    alert: NOT_RAISED,
    ...overrides,
  };
}

function timelineOf(
  events: MilestoneEvent[],
  overrides: Partial<MilestoneTimelineData> = {}
): MilestoneTimelineData {
  return {
    events,
    asOf: new Date("2026-06-22T00:00:00.000Z"),
    launchDate: "2026-09-20",
    launchStatus: "scheduled",
    daysUntilLaunch: 90,
    audience: "planter",
    ...overrides,
  };
}

const LAUNCH_EVENT = event({
  id: "launch-day",
  kind: "launch_day",
  at: new Date("2026-09-20T00:00:00.000Z"),
  label: "Launch Sunday",
  detail: null,
  state: "upcoming",
});

// ----------------------------------------------------------------------------
// The rows.
// ----------------------------------------------------------------------------

test("renders the key dates as rows, in the order it was handed", () => {
  const html = render(
    timelineOf([
      event(),
      event({
        id: "m1",
        kind: "first_vision_meeting",
        at: new Date("2026-02-10T18:00:00.000Z"),
        label: "First vision meeting",
        detail: "12 attended.",
      }),
      LAUNCH_EVENT,
    ])
  );
  const rendered = rows(html);

  assert.equal(rendered.length, 3);
  assert.deepEqual(
    rendered.map((row) => attr(row, "data-kind")),
    ["phase_declared", "first_vision_meeting", "launch_day"]
  );
  assert.deepEqual(
    rendered.map((row) => attr(row, "data-date")),
    ["2026-01-05", "2026-02-10", "2026-09-20"]
  );
});

test("each row carries its own date as text, zone-pinned", () => {
  const rendered = rows(render(timelineOf([LAUNCH_EVENT])));

  // UTC is APP_TIME_ZONE, so the rendered day is the stored day — a launch on
  // the 20th never reads as the 19th.
  assert.match(text(rendered[0]), /Sun, Sep 20, 2026/);
});

test("a planned day is labelled planned; a past one is not", () => {
  const rendered = rows(render(timelineOf([event(), LAUNCH_EVENT])));

  assert.equal(attr(rendered[0], "data-state"), "past");
  assert.equal(text(rendered[0]).includes("Planned"), false);
  assert.equal(attr(rendered[1], "data-state"), "upcoming");
  assert.match(text(rendered[1]), /Planned/);
});

// ----------------------------------------------------------------------------
// The launch date.
// ----------------------------------------------------------------------------

test("the launch date renders with its countdown", () => {
  const html = render(timelineOf([LAUNCH_EVENT]));

  assert.ok(html.includes('data-testid="milestone-launch-date"'));
  const line = html.split('data-testid="milestone-launch-date"')[1];
  assert.equal(attr(line, "data-launch-date"), "2026-09-20");
  assert.match(text(line), /Launch Sunday/);
  assert.match(text(line), /Sunday, September 20, 2026/);
  assert.match(text(line), /in 90 days/);
});

test("launch day itself reads as today, not as a day ago", () => {
  const html = render(
    timelineOf([LAUNCH_EVENT], {
      asOf: new Date("2026-09-20T13:00:00.000Z"),
      daysUntilLaunch: 0,
    })
  );

  assert.match(text(html), /Launch Sunday Sunday, September 20, 2026 · today/);
});

test("a launch already behind the plant counts up, in the plural or not", () => {
  const many = render(timelineOf([LAUNCH_EVENT], { daysUntilLaunch: -12 }));
  assert.match(text(many), /12 days ago/);

  const one = render(timelineOf([LAUNCH_EVENT], { daysUntilLaunch: -1 }));
  assert.match(text(one), /1 day ago/);
});

test("a postponed launch says so", () => {
  const html = render(
    timelineOf([LAUNCH_EVENT], { launchStatus: "postponed" })
  );

  assert.match(text(html), /postponed once/);
});

test("no launch date is a state with a way out of it", () => {
  const html = render(
    timelineOf([event()], {
      launchDate: null,
      launchStatus: "planning",
      daysUntilLaunch: null,
    })
  );

  assert.ok(html.includes('data-testid="milestone-no-launch-date"'));
  assert.match(text(html), /No launch date yet/);
  // The one write path for the date is `/launch`, so that is where it points.
  assert.match(html, /href="\/launch"/);
  assert.equal(html.includes('data-testid="milestone-launch-date"'), false);
});

// ----------------------------------------------------------------------------
// Badges.
// ----------------------------------------------------------------------------

test("a row's badge is the persisted severity's standing", () => {
  const rendered = rows(
    render(
      timelineOf([
        {
          ...LAUNCH_EVENT,
          alert: {
            standing: "watch",
            severity: "medium",
            insightId: "insight-7",
            insightTitle: "Readiness is slipping",
            insightCount: 1,
          },
        },
      ])
    )
  );

  assert.equal(attr(rendered[0], "data-standing"), "watch");
  const badge = rendered[0].split('data-slot="milestone-alert"')[1];
  assert.ok(badge);
  assert.equal(attr(badge, "data-severity"), "medium");
  assert.equal(attr(badge, "data-insight-id"), "insight-7");
  assert.match(text(badge), /Worth a look/);
});

test("a row the assessment did not speak to wears no badge", () => {
  const rendered = rows(render(timelineOf([event()])));

  assert.equal(attr(rendered[0], "data-standing"), "not_raised");
  assert.equal(rendered[0].includes('data-slot="milestone-alert"'), false);
  assert.equal(text(rendered[0]).includes("Not raised"), false);
});

// ----------------------------------------------------------------------------
// Empty states.
// ----------------------------------------------------------------------------

test("a plant with nothing dated gets an empty state, not an empty box", () => {
  const html = render(
    timelineOf([], {
      launchDate: null,
      launchStatus: null,
      daysUntilLaunch: null,
    })
  );

  assert.equal(rows(html).length, 0);
  assert.ok(html.includes('data-testid="milestone-timeline-empty"'));
  assert.match(text(html), /Nothing is dated yet/);
});

test("no timeline renders nothing at all", () => {
  assert.equal(render(null), "");
});
