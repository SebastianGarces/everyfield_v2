import { z } from "zod";
import { parseEvryConversationArtifactDocument } from "../../conversations/artifacts";
import { evryResultState, findResult } from "./results";

export const eveResultSelectionInputSchema = z.strictObject({
  selections: z
    .array(
      z.strictObject({
        resultReference: z.string().min(1).max(240),
        itemIds: z
          .array(z.string().min(1).max(160))
          .min(1)
          .max(100)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "Choose each item once"
          ),
      })
    )
    .min(1)
    .max(24)
    .refine(
      (sources) =>
        new Set(sources.map((source) => source.resultReference)).size ===
        sources.length,
      "Choose each source once"
    )
    .refine(
      (sources) =>
        sources.reduce((sum, source) => sum + source.itemIds.length, 0) <= 100,
      "Select at most 100 items"
    ),
});
export type EveResultSelectionInput = z.infer<
  typeof eveResultSelectionInputSchema
>;

/** Data-only projection. The caller owns fresh session scope and native publication. */
export function selectEveResultRows(
  records: Parameters<typeof findResult>[0],
  turnId: string,
  input: EveResultSelectionInput
) {
  const selectedSources = [];
  for (const selection of input.selections) {
    const source = findResult(records, selection.resultReference, turnId);
    if (!source || source.capability === "actions.prepare")
      return {
        status: "unavailable" as const,
        reason: "source_result_unavailable",
      };
    if (source.artifacts.length !== 1)
      return { status: "unavailable" as const, reason: "source_not_a_list" };
    const artifact = parseEvryConversationArtifactDocument(source.artifacts[0]);
    if (
      artifact.kind !== "read" ||
      (artifact.resultMode !== undefined && artifact.resultMode !== "list")
    )
      return { status: "unavailable" as const, reason: "source_not_a_list" };
    const byId = new Map(artifact.items.map((item) => [item.id, item]));
    if (
      byId.size !== artifact.items.length ||
      selection.itemIds.some((id) => !byId.has(id))
    )
      return {
        status: "invalid_input" as const,
        reason: "items_not_in_source",
      };
    // Keep source order; callers select membership, never manufacture row values.
    const selected = new Set(selection.itemIds);
    selectedSources.push({
      source,
      artifact,
      items: artifact.items.filter((item) => selected.has(item.id)),
    });
  }
  const first = selectedSources[0];
  if (!first) return { status: "invalid_input" as const };
  const capability =
    first.artifact.selection?.capability ?? first.source.capability;
  if (
    selectedSources.some(
      ({ source, artifact }) =>
        (artifact.selection?.capability ?? source.capability) !== capability ||
        artifact.title !== first.artifact.title ||
        artifact.resultMode !== first.artifact.resultMode
    )
  )
    return { status: "invalid_input" as const, reason: "incompatible_sources" };
  const byId = new Map<string, (typeof first.artifact.items)[number]>();
  for (const { items } of selectedSources)
    for (const item of items) {
      const previous = byId.get(item.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(item))
        return {
          status: "invalid_input" as const,
          reason: "conflicting_items",
        };
      byId.set(item.id, item);
    }
  const items = [...byId.values()];
  const sourceLinks = [
    ...new Map(
      selectedSources
        .flatMap(({ artifact }) => artifact.sourceLinks)
        .map((link) => [link.href, link])
    ).values(),
  ];
  if (sourceLinks.length > 32)
    return {
      status: "invalid_input" as const,
      reason: "too_many_source_links",
    };
  const provenance = selectedSources.flatMap(({ source, artifact, items }) => {
    const ids = new Set(items.map((item) => item.id));
    return artifact.selection
      ? artifact.selection.sources
          .map((entry) => ({
            ...entry,
            itemIds: entry.itemIds.filter((id) => ids.has(id)),
          }))
          .filter((entry) => entry.itemIds.length > 0)
      : [
          {
            reference: source.reference,
            itemIds: [...ids],
            counts: artifact.counts,
            filters: artifact.filters,
            exclusions: artifact.exclusions,
          },
        ];
  });
  if (provenance.length > 24)
    return {
      status: "invalid_input" as const,
      reason: "too_many_source_results",
    };
  return {
    ...first.artifact,
    resultMode: "list" as const,
    selection: { capability, sources: provenance },
    filters: [],
    counts: { matched: items.length, returned: items.length, excluded: 0 },
    exclusions: [],
    items,
    sourceLinks,
  };
}

/** Only used inside the freshly authenticated native runtime scope. */
export function selectCurrentEveResultRows(
  turnId: string,
  input: EveResultSelectionInput
) {
  return selectEveResultRows(evryResultState.get(), turnId, input);
}

/** Cached records do not preserve a permission that the actor has since lost. */
export async function selectAuthorizedCurrentEveResultRows(
  turnId: string,
  input: EveResultSelectionInput,
  authorize: (identity: string) => Promise<boolean>
) {
  const records = evryResultState.get();
  const selected = selectEveResultRows(records, turnId, input);
  if (!("items" in selected))
    return { result: selected, authorizationIdentities: [] };
  const identities = new Set<string>();
  for (const selection of input.selections) {
    const source = findResult(records, selection.resultReference, turnId);
    if (!source?.authorizationIdentities?.length)
      return {
        result: {
          status: "unavailable" as const,
          reason: "source_result_unavailable",
        },
        authorizationIdentities: [],
      };
    for (const identity of source.authorizationIdentities)
      identities.add(identity);
  }
  for (const identity of identities)
    if (!(await authorize(identity)))
      return {
        result: { status: "unavailable" as const, reason: "not_authorized" },
        authorizationIdentities: [],
      };
  return { result: selected, authorizationIdentities: [...identities] };
}
