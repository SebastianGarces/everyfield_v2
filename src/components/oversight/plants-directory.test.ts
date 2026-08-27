import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { OversightPlantSummary } from "@/lib/oversight/types";

import { PlantsDirectory } from "./plants-directory";

const PLANTS: OversightPlantSummary[] = [
  {
    churchId: "plant-1",
    name: "Antioch Church",
    location: "Austin, Texas, US",
    planterName: "Daniel Reyes",
    currentPhase: 2,
    launchDate: "2026-09-01",
    daysUntilLaunch: 5,
    provenance: {
      orgType: "network",
      orgName: "Hope Network",
      associatedAt: null,
      viaSendingChurchName: "Grace Church",
    },
  },
  {
    churchId: "plant-2",
    name: "Bethany Church",
    location: null,
    planterName: null,
    currentPhase: 4,
    launchDate: null,
    daysUntilLaunch: null,
    provenance: {
      orgType: "network",
      orgName: "Hope Network",
      associatedAt: null,
      viaSendingChurchName: null,
    },
  },
  {
    churchId: "plant-3",
    name: "Cornerstone Church",
    location: "Dallas, Texas, US",
    planterName: "Avery Morgan",
    currentPhase: 5,
    launchDate: "2026-08-20",
    daysUntilLaunch: -7,
    provenance: {
      orgType: "sending_church",
      orgName: "Sending Church",
      associatedAt: null,
      viaSendingChurchName: null,
    },
  },
];

function directory(): string {
  return renderToStaticMarkup(
    createElement(PlantsDirectory, {
      plants: PLANTS,
      scopeLabel: "network",
      canInvite: true,
    })
  );
}

function tableMarkup(markup: string): string {
  return markup.slice(markup.indexOf("<table"), markup.indexOf("</table>") + 8);
}

function mobileRows(markup: string): string[] {
  const mobileList = markup.slice(
    markup.indexOf('class="grid gap-4 lg:hidden"')
  );
  return mobileList.match(/<li\b[\s\S]*?<\/li>/g) ?? [];
}

test("the wide directory keeps every plant's comparison facts in shared columns (#726)", () => {
  const markup = directory();
  const wideTable = tableMarkup(markup);

  assert.match(wideTable, /<table/);
  for (const heading of [
    "Plant",
    "Phase",
    "Planter",
    "Launch",
    "Association",
  ]) {
    assert.match(wideTable, new RegExp(`>${heading}<`));
  }

  for (const plant of PLANTS) {
    assert.match(
      wideTable,
      new RegExp(`href="/oversight/plants/${plant.churchId}"`)
    );
    assert.match(wideTable, new RegExp(plant.name));
  }

  assert.match(wideTable, /Daniel Reyes/);
  assert.match(wideTable, /No planter assigned yet/);
  assert.match(wideTable, /5 days to launch/);
  assert.match(wideTable, /No launch date set/);
  assert.match(wideTable, /Launched 7 days ago/);
  assert.match(wideTable, /through Grace Church/);

  assert.ok(
    wideTable.indexOf("Antioch Church") < wideTable.indexOf("Bethany Church")
  );
  assert.ok(
    wideTable.indexOf("Bethany Church") <
      wideTable.indexOf("Cornerstone Church")
  );
});

test("the narrow directory preserves labeled facts and detail navigation (#726)", () => {
  const rows = mobileRows(directory());

  assert.equal(rows.length, PLANTS.length);
  for (const row of rows) {
    for (const label of [
      "Plant",
      "Phase",
      "Planter",
      "Launch",
      "Association",
    ]) {
      assert.match(row, new RegExp(`>${label}<`));
    }
  }

  assert.match(
    rows[0],
    /Antioch Church.*Austin, Texas, US.*Phase 2: Launch Team Formation.*Daniel Reyes.*5 days to launch.*Associated with Hope Network.*through Grace Church/
  );
  assert.match(
    rows[1],
    /Bethany Church.*Phase 4: Pre-Launch.*No planter assigned yet.*No launch date set.*Associated with Hope Network/
  );
  assert.doesNotMatch(
    rows[1],
    /Austin, Texas, US|Dallas, Texas, US|Location not set/
  );
  assert.match(
    rows[2],
    /Cornerstone Church.*Dallas, Texas, US.*Phase 5: Launch Sunday.*Avery Morgan.*Launched 7 days ago.*Associated with Sending Church/
  );

  assert.match(rows[0], /href="\/oversight\/plants\/plant-1"/);
  assert.match(rows[1], /href="\/oversight\/plants\/plant-2"/);
  assert.match(rows[2], /href="\/oversight\/plants\/plant-3"/);
});
