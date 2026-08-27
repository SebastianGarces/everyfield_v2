import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { teamStaffingDisplay } from "@/lib/ministry-teams/team-display";

import { OrgChartView } from "./org-chart-view";
import { TeamCardView, type TeamCardViewTeam } from "./team-card-view";

const TEAM: TeamCardViewTeam = {
  id: "team-1",
  name: "Worship",
  type: "predefined",
  status: "active",
  icon: "music",
  leaderName: null,
  filledRoles: 0,
  totalRoles: 0,
};

function card(overrides: Partial<TeamCardViewTeam> = {}): string {
  return renderToStaticMarkup(
    createElement(TeamCardView, { team: { ...TEAM, ...overrides } })
  );
}

function orgNode(overrides: Partial<TeamCardViewTeam> = {}): string {
  return renderToStaticMarkup(
    createElement(OrgChartView, {
      teams: [{ ...TEAM, ...overrides, templateKey: "worship" }] as never,
    })
  );
}

test("a team without roles is a neutral display state", () => {
  assert.deepEqual(teamStaffingDisplay(0, 0), {
    kind: "no_roles",
    percentage: 0,
    label: "No roles defined",
  });

  const teamCard = card();
  assert.match(teamCard, /data-staffing="neutral"/);
  assert.match(teamCard, /No roles defined/);
  assert.doesNotMatch(teamCard, /bg-red-500/);

  const chart = orgNode();
  assert.match(chart, /No roles defined/);
  assert.doesNotMatch(chart, /0\/0 roles/);
  assert.doesNotMatch(chart, /bg-red-100/);
});

test("configured teams keep their staffing thresholds, counts, and warning colors", () => {
  const cases = [
    {
      name: "below 40%",
      filledRoles: 1,
      totalRoles: 3,
      percentage: 33,
      cardLevel: "red",
      cardColor: "bg-red-500",
      orgChartColor: "bg-red-100",
    },
    {
      name: "exactly 40%",
      filledRoles: 2,
      totalRoles: 5,
      percentage: 40,
      cardLevel: "yellow",
      cardColor: "bg-yellow-500",
      orgChartColor: "bg-amber-100",
    },
    {
      name: "below 60%",
      filledRoles: 1,
      totalRoles: 2,
      percentage: 50,
      cardLevel: "yellow",
      cardColor: "bg-yellow-500",
      orgChartColor: "bg-amber-100",
    },
    {
      name: "exactly 60%",
      filledRoles: 3,
      totalRoles: 5,
      percentage: 60,
      cardLevel: "green",
      cardColor: "bg-green-500",
      orgChartColor: null,
    },
    {
      name: "100%",
      filledRoles: 5,
      totalRoles: 5,
      percentage: 100,
      cardLevel: "green",
      cardColor: "bg-green-500",
      orgChartColor: "bg-green-100",
    },
  ] as const;

  for (const configured of cases) {
    assert.deepEqual(
      teamStaffingDisplay(configured.filledRoles, configured.totalRoles),
      {
        kind: "configured",
        percentage: configured.percentage,
        level: configured.cardLevel,
      }
    );

    const teamCard = card(configured);
    assert.match(
      teamCard,
      new RegExp(`data-staffing="${configured.cardLevel}"`)
    );
    assert.match(
      teamCard,
      new RegExp(`${configured.filledRoles}/${configured.totalRoles}`)
    );
    assert.match(teamCard, new RegExp(configured.cardColor));

    const chart = orgNode(configured);
    assert.match(
      chart,
      new RegExp(`${configured.filledRoles}/${configured.totalRoles} roles`)
    );
    if (configured.orgChartColor) {
      assert.match(chart, new RegExp(configured.orgChartColor));
    } else {
      assert.doesNotMatch(chart, /bg-(?:red|amber|green)-100/);
    }
  }
});
