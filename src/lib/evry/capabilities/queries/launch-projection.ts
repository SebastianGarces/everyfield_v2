import type { EvryReadArtifact } from "@/lib/evry/artifacts/types";

/** Launch status has a domain reading order, independent of JSONB key ordering. */
export function projectLaunchStatus(
  artifact: EvryReadArtifact
): EvryReadArtifact {
  return {
    ...artifact,
    items: artifact.items.map((item) => {
      const byLabel = new Map(item.facts.map((fact) => [fact.label, fact]));
      const complete = byLabel.get("Milestones complete");
      const total = byLabel.get("Milestones total");
      const progress =
        complete && total
          ? [
              {
                label: "Milestone progress",
                value: `${complete.value} of ${total.value} complete`,
              },
            ]
          : [];
      const ordered = [
        "Launch date",
        "Status",
        "Days until launch",
        "Milestones remaining",
        "Milestones complete",
        "Milestones total",
      ];
      return {
        ...item,
        facts: [
          ...(byLabel.has("Launch date") ? [byLabel.get("Launch date")!] : []),
          ...progress,
          ...ordered
            .filter((label) => label !== "Launch date")
            .flatMap((label) =>
              byLabel.has(label) ? [byLabel.get(label)!] : []
            ),
          ...item.facts.filter((fact) => !ordered.includes(fact.label)),
        ],
      };
    }),
  };
}
