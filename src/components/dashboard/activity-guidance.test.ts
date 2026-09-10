import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { SeatFields } from "@/lib/auth/tenancy";
import type { ActivityItem } from "@/lib/dashboard/service";
import type { PhaseNumber } from "@/lib/constants";
import { ActivityFeed } from "./activity-feed";
import { ActivityGuidance } from "./activity-guidance";

const plant: SeatFields = {
  seat: "owner",
  churchId: "plant-a",
  sendingChurchId: null,
  sendingNetworkId: null,
};

function render(
  viewer: SeatFields,
  phase: PhaseNumber,
  activities: ActivityItem[] = []
) {
  return renderToStaticMarkup(
    createElement(ActivityFeed, {
      activities,
      emptyGuidance: createElement(ActivityGuidance, { viewer, phase }),
    })
  );
}

test("each phase opens its relevant Playbook article and permitted first action", () => {
  const expected = [
    [0, "getting-started/welcome-to-the-launch-playbook", "people"],
    [1, "core-group/building-your-core-group/the-core-group-funnel", "people"],
    [2, "launch-team/launch-date/transitioning-to-launch-team", "meetings"],
    [3, "training/training-programs-overview", "meetings"],
    [4, "pre-launch/final-checklist-review", "meetings"],
    [5, "launch-sunday/launch-day-guide", "people"],
    [6, "post-launch/the-guest-assimilation-journey", "people"],
  ] as const;
  for (const [phase, article, action] of expected) {
    for (const seat of ["owner", "admin"] as const) {
      const html = render({ ...plant, seat }, phase);
      assert.ok(html.includes(`href="/wiki/${article}"`));
      assert.ok(html.includes(`href="/${action}/new"`));
      assert.ok(html.includes(`Phase ${phase}:`));
    }
  }
});

test("Member, coach, foreign-tenancy Owner and conflicting tenancy get only reading guidance", () => {
  const viewers: SeatFields[] = [
    { ...plant, seat: "member" },
    { ...plant, seat: null },
    { ...plant, seat: null, churchId: null },
    { ...plant, churchId: null, sendingNetworkId: "network" },
    { ...plant, sendingNetworkId: "network" },
  ];
  for (const viewer of viewers) {
    for (const phase of [0, 1, 2, 3, 4, 5, 6] as const) {
      const html = render(viewer, phase);
      assert.match(html, /href="\/wiki\//);
      assert.doesNotMatch(html, /href="\/(people|meetings)\/new"/);
      assert.doesNotMatch(
        html,
        /Add a person|Schedule a meeting|Start by adding/
      );
    }
  }
});

test("populated activity suppresses all guidance and preserves the activity row", () => {
  const activity: ActivityItem = {
    id: "activity-829",
    type: "person_created",
    description: "Added test contact",
    timestamp: new Date(),
    metadata: {},
  };
  const populated = render(plant, 1, [activity]);
  const withoutGuidance = renderToStaticMarkup(
    createElement(ActivityFeed, { activities: [activity] })
  );
  assert.equal(populated, withoutGuidance);
  assert.match(populated, /Added test contact/);
  assert.doesNotMatch(populated, /No activity yet|href=|Phase 1/);
});

test("an embed without viewer context offers no unguarded action", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityFeed, { activities: [] })
  );
  assert.match(html, /People updates, completed meetings, and completed/);
  assert.doesNotMatch(html, /href=|Start by/);
});
