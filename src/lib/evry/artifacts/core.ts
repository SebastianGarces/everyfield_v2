import type {
  EvryReadArtifact,
  EvryReadExclusion,
  EvryReadFilter,
  EvryReadItem,
  TrustedEvryApplicationSourceLink,
} from "./types";
export { trustedEvryApplicationSourceLink } from "./types";

function countExclusions(exclusions: readonly EvryReadExclusion[]): number {
  return exclusions.reduce((total, exclusion) => {
    if (!Number.isSafeInteger(exclusion.count) || exclusion.count < 0) {
      throw new Error("Evry exclusion counts must be non-negative integers");
    }
    return total + exclusion.count;
  }, 0);
}

function snapshotFilters(
  filters: readonly EvryReadFilter[]
): readonly EvryReadFilter[] {
  return Object.freeze(filters.map((filter) => Object.freeze({ ...filter })));
}

function snapshotExclusions(
  exclusions: readonly EvryReadExclusion[]
): readonly EvryReadExclusion[] {
  return Object.freeze(
    exclusions.map((exclusion) => Object.freeze({ ...exclusion }))
  );
}

function snapshotItems(
  items: readonly EvryReadItem[]
): readonly EvryReadItem[] {
  return Object.freeze(
    items.map((item) =>
      Object.freeze({
        ...item,
        facts: Object.freeze(
          item.facts.map((fact) => Object.freeze({ ...fact }))
        ),
      })
    )
  );
}

/** Build counts from the rows and exclusions so the three values cannot drift. */
export function buildEvryReadArtifact({
  title,
  filters,
  exclusions,
  items,
  sourceLinks,
}: {
  title: string;
  filters: readonly EvryReadFilter[];
  exclusions: readonly EvryReadExclusion[];
  items: readonly EvryReadItem[];
  sourceLinks: readonly TrustedEvryApplicationSourceLink[];
}): EvryReadArtifact {
  const stableFilters = snapshotFilters(filters);
  const stableExclusions = snapshotExclusions(exclusions);
  const stableItems = snapshotItems(items);
  const stableSourceLinks = Object.freeze([...sourceLinks]);
  const excluded = countExclusions(stableExclusions);

  return Object.freeze({
    kind: "read",
    title,
    filters: stableFilters,
    counts: Object.freeze({
      matched: stableItems.length + excluded,
      returned: stableItems.length,
      excluded,
    }),
    exclusions: stableExclusions,
    items: stableItems,
    sourceLinks: stableSourceLinks,
  });
}
