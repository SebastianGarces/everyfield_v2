import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";

import type { EvryEntityChoice } from "../artifacts/types";
import type {
  EvryEntityResolution,
  EvryPageContext,
  EvryResolverAdapter,
  EvryResolverCandidate,
} from "./contract";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCandidates(
  left: EvryResolverCandidate,
  right: EvryResolverCandidate
): number {
  if (left.match !== right.match) return left.match === "exact" ? -1 : 1;
  return (
    compareText(left.label.toLowerCase(), right.label.toLowerCase()) ||
    compareText(left.label, right.label) ||
    compareText(left.id, right.id) ||
    compareText(left.sourceLink.href, right.sourceLink.href)
  );
}

function eligibleTier(
  candidates: readonly EvryResolverCandidate[]
): readonly EvryResolverCandidate[] {
  const ordered = [...candidates].sort(compareCandidates);
  const byId = new Map<string, EvryResolverCandidate>();
  for (const candidate of ordered) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  const deduplicated = [...byId.values()];
  const exact = deduplicated.filter((candidate) => candidate.match === "exact");
  return exact.length > 0
    ? exact
    : deduplicated.filter((candidate) => candidate.match === "fuzzy");
}

function choiceOf(
  entityType: string,
  candidate: EvryResolverCandidate
): EvryEntityChoice {
  return {
    entityType,
    id: candidate.id,
    label: candidate.label,
    distinguishingFacts: candidate.distinguishingFacts,
    sourceLink: candidate.sourceLink,
  };
}

/**
 * Resolve eligible candidates without scoring or guessing.
 *
 * Exact candidates form the whole decision set when any exist. Otherwise the
 * fuzzy candidates do. More than one candidate always asks the person.
 */
export function resolveEvryCandidates({
  entityType,
  prompt,
  candidates,
}: {
  entityType: string;
  prompt: string;
  candidates: readonly EvryResolverCandidate[];
}): EvryEntityResolution {
  const tier = eligibleTier(candidates);

  if (tier.length === 0) {
    return {
      status: "clarification",
      artifact: { kind: "clarification", mode: "missing", entityType, prompt },
    };
  }

  if (tier.length === 1) {
    return { status: "resolved", entity: choiceOf(entityType, tier[0]) };
  }

  const choices = tier.map((candidate) => choiceOf(entityType, candidate));
  return {
    status: "clarification",
    artifact: {
      kind: "clarification",
      mode: "choice",
      entityType,
      prompt,
      choices: [choices[0], choices[1], ...choices.slice(2)],
      defaultChoiceId: null,
    },
  };
}

/** Give a trusted adapter fresh authorization and page context only as a hint. */
export async function resolveEvryEntity({
  authorization,
  entityType,
  referenceText,
  prompt,
  pageContext,
  findCandidates,
}: {
  authorization: EvryReadCapabilityAuthorization;
  entityType: string;
  referenceText: string;
  prompt: string;
  pageContext: EvryPageContext | null;
  findCandidates: EvryResolverAdapter;
}): Promise<EvryEntityResolution> {
  const candidates = await findCandidates({
    authorization,
    referenceText,
    pageContext,
  });
  return resolveEvryCandidates({ entityType, prompt, candidates });
}
