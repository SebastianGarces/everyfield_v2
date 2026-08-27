import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { PlantDetail } from "./plant-detail";
import type {
  OversightPlantDetail,
  OversightSectionResult,
} from "@/lib/oversight/types";

const plant = {
  churchId: "church-1",
  name: "Genesis Church",
  location: null,
  planterName: null,
  currentPhase: 1,
  launchDate: null,
  daysUntilLaunch: null,
  provenance: {
    orgType: "network" as const,
    orgName: "Genesis Network",
    viaSendingChurchName: null,
    associatedAt: null,
  },
};

function renderDetail(sections: OversightSectionResult[]) {
  const detail: OversightPlantDetail = { plant, sections };

  return renderToStaticMarkup(
    createElement(PlantDetail, {
      detail,
      scopeLabel: "network",
      history: [],
      canSever: false,
    })
  );
}

function renderAggregateSections(sections: OversightSectionResult[]) {
  const markup = renderDetail(sections);
  const start = markup.indexOf('<section aria-labelledby="plant-aggregates"');
  const end = markup.indexOf(
    '<section aria-labelledby="plant-association-history"'
  );

  assert.notEqual(start, -1, "aggregate section should render");
  assert.notEqual(end, -1, "association history should follow aggregates");
  return markup.slice(start, end);
}

test("withheld sections share one privacy explanation and never render hidden statistics", () => {
  // Runtime data must not make a withheld statistic visible even if a caller
  // bypasses the discriminated union at the boundary.
  const sections = [
    {
      key: "people",
      state: "withheld",
      stats: [{ label: "Hidden people total", value: "913" }],
    },
    { key: "meetings", state: "withheld" },
    { key: "tasks", state: "withheld" },
    { key: "ministry_teams", state: "withheld" },
  ] as unknown as OversightSectionResult[];

  const markup = renderAggregateSections(sections);

  assert.equal(
    markup.split("each plant decides what it shares").length - 1,
    1,
    "the section introduction is the single privacy explanation"
  );
  assert.equal((markup.match(/<dl/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /data-slot="card"|divide-y/);

  const rows = [
    ...markup.matchAll(/<dt[^>]*>([^<]+)<\/dt><dd[^>]*>([^<]+)<\/dd>/g),
  ].map(([, label, status]) => [label, status]);
  assert.deepEqual(rows, [
    ["People", "Not shared"],
    ["Meeting cadence", "Not shared"],
    ["Task health", "Not shared"],
    ["Ministry-team coverage", "Not shared"],
  ]);
  assert.doesNotMatch(markup, /Hidden people total|913/);
});

test("a shared-empty section keeps its distinct empty state", () => {
  const markup = renderAggregateSections([
    {
      key: "people",
      state: "shared",
      isEmpty: true,
      stats: [{ label: "Total people", value: "0" }],
    },
  ]);

  assert.match(markup, /Nothing recorded yet/);
  assert.match(markup, /Genesis Church shares its people pipeline/);
  assert.doesNotMatch(markup, /Not shared|Total people/);
});

test("a shared-populated section keeps its statistics", () => {
  const markup = renderAggregateSections([
    {
      key: "people",
      state: "shared",
      isEmpty: false,
      stats: [{ label: "Total people", value: "42", hint: "across stages" }],
    },
  ]);

  assert.match(markup, /Total people/);
  assert.match(markup, />42</);
  assert.match(markup, /across stages/);
  assert.doesNotMatch(markup, /Nothing recorded yet|Not shared/);
});

test("mixed states retain their section order", () => {
  const markup = renderAggregateSections([
    { key: "people", state: "withheld" },
    {
      key: "meetings",
      state: "shared",
      isEmpty: false,
      stats: [{ label: "Completed meetings", value: "6" }],
    },
    { key: "tasks", state: "withheld" },
  ]);

  const peopleAt = markup.indexOf("People");
  const meetingsAt = markup.indexOf("Meeting cadence");
  const tasksAt = markup.indexOf("Task health");

  assert.ok(peopleAt < meetingsAt, "People should stay before Meeting cadence");
  assert.ok(
    meetingsAt < tasksAt,
    "Meeting cadence should stay before Task health"
  );
});
