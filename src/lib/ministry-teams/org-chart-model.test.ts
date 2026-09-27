import assert from "node:assert/strict";
import test from "node:test";
import {
  chartTextLines,
  drawOrgChart,
  type ChartTeam,
} from "./org-chart-model";

const teams: ChartTeam[] = [
  {
    id: "root",
    name: "Renamed leadership",
    templateKey: "senior_pastor",
    leader: { id: "pastor", name: "Sam Pastor" },
    roles: [
      {
        id: "pastor-role",
        name: "Senior Pastor",
        leadership: true,
        person: { id: "pastor", name: "Sam Pastor" },
      },
    ],
  },
  {
    id: "custom",
    name: "Neighborhood care",
    templateKey: null,
    leader: { id: "multi", name: "Pat Volunteer" },
    roles: [
      {
        id: "role1",
        name: "Coordinator",
        leadership: true,
        person: { id: "multi", name: "Pat Volunteer" },
      },
      {
        id: "role2",
        name: "Visitor",
        leadership: false,
        person: { id: "multi", name: "Pat Volunteer" },
      },
      { id: "vacant", name: "Driver", leadership: false, person: null },
    ],
  },
];

test("renamed template root is above custom team, repeated people retain every role and vacancies", () => {
  const chart = drawOrgChart(teams);
  assert.ok(
    chart.boxes.find((box) => box.key === "team-root")!.y <
      chart.boxes.find((box) => box.key === "team-custom")!.y
  );
  assert.equal(
    chart.boxes.filter((box) => box.href === "/people/multi").length,
    3
  );
  assert.equal(
    chart.boxes.find((box) => box.key === "role-vacant")!.kind,
    "vacancy"
  );
  assert.equal(
    chart.boxes.find((box) => box.key === "role-vacant")!.href,
    null
  );
  assert.equal(
    chart.boxes.find((box) => box.key === "team-custom")!.href,
    "/teams/custom"
  );
  for (const box of chart.boxes) {
    assert.ok(box.x >= 0 && box.y >= 0);
    assert.ok(box.x + box.width <= chart.width);
    assert.ok(box.y + box.height <= chart.height);
  }
});

test("single-team scope excludes root and other members without mutating full chart", () => {
  const chart = drawOrgChart(teams, "custom");
  assert.equal(chart.boxes.length, 5);
  assert.ok(
    chart.boxes.every(
      (box) => box.href !== "/people/pastor" && box.href !== "/teams/root"
    )
  );
  assert.equal(drawOrgChart(teams).boxes.length, 8);
});

test("all names and large rosters fit the full export bounds without truncation", () => {
  const longName = "VeryLongUnbrokenPersonName".repeat(8);
  assert.equal(chartTextLines(longName).join(""), longName);
  const many: ChartTeam = {
    ...teams[1],
    name: longName,
    roles: Array.from({ length: 250 }, (_, i) => ({
      id: String(i),
      name: longName,
      leadership: false,
      person: { id: String(i), name: longName },
    })),
  };
  const chart = drawOrgChart([many]);
  assert.equal(chart.boxes.length, 252);
  assert.ok(chart.boxes.every((box) => box.y + box.height < chart.height));
  assert.equal(chart.boxes.at(-1)!.title.join(""), longName);
});
