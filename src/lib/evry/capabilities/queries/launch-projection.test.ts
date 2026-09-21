import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import {
  publicEvryArtifact,
  publicReadArtifactSchema,
} from "@/lib/evry/artifacts/public";
import { projectLaunchStatus } from "./launch-projection";

test("launch cards lead with date and real milestone progress, retaining evidence", () => {
  const sourceLink = trustedEvryApplicationSourceLink({
    label: "Open launch",
    href: "/launch",
  });
  const artifact = buildEvryReadArtifact({
    title: "Launch status",
    filters: [],
    exclusions: [],
    sourceLinks: [sourceLink],
    items: [
      {
        id: "launch",
        label: "Launch Sunday",
        sourceLink,
        facts: [
          { label: "Status", value: "Scheduled" },
          { label: "Decisions", value: "Not recorded" },
          { label: "Milestones total", value: "9" },
          { label: "Launch date", value: "Oct 11, 2026" },
          { label: "Milestones complete", value: "4" },
          { label: "Milestones remaining", value: "5" },
        ],
      },
    ],
  });
  const projected = projectLaunchStatus(artifact);
  const visible = publicReadArtifactSchema.parse(publicEvryArtifact(projected));
  assert.deepEqual(visible.items[0].facts.slice(0, 2), [
    { label: "Launch date", value: "Oct 11, 2026" },
    { label: "Milestone progress", value: "4 of 9 complete" },
  ]);
  for (const fact of artifact.items[0].facts)
    assert.ok(projected.items[0].facts.includes(fact));
  assert.equal(
    artifact.items[0].facts[0].label,
    "Status",
    "Projection must not mutate stored evidence"
  );
});

test("zero milestones remains an exact count, not an invented readiness percentage", () => {
  const sourceLink = trustedEvryApplicationSourceLink({
    label: "Open launch",
    href: "/launch",
  });
  const artifact = buildEvryReadArtifact({
    title: "Launch",
    filters: [],
    exclusions: [],
    sourceLinks: [sourceLink],
    items: [
      {
        id: "launch",
        label: "Launch Sunday",
        sourceLink,
        facts: [
          { label: "Milestones complete", value: "0" },
          { label: "Milestones total", value: "0" },
        ],
      },
    ],
  });
  assert.equal(
    projectLaunchStatus(artifact).items[0].facts[0].value,
    "0 of 0 complete"
  );
});
