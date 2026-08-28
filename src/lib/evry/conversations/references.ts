import type {
  EvryClarificationArtifact,
  EvryEntityChoice,
} from "../artifacts/types";
import { trustedEvryApplicationSourceLink } from "../artifacts/types";

import {
  normalizeEvryReferenceAlias,
  evryConversationRelevanceKeySchema,
  type EvryConversationRelevanceKey,
  type EvryConversationStateDocument,
  type EvryResolvedReference,
} from "./contract";

const PRONOUNS = new Set([
  "he",
  "her",
  "hers",
  "him",
  "his",
  "it",
  "its",
  "she",
  "that one",
  "they",
  "them",
  "their",
  "theirs",
  "those",
]);

export type EvryConversationReferenceResolution =
  | Readonly<{ status: "not_applicable" }>
  | Readonly<{
      status: "resolved";
      reference: EvryResolvedReference;
      relevanceKeys: readonly EvryConversationRelevanceKey[];
    }>
  | Readonly<{
      status: "clarification";
      reason: "missing" | "ambiguous" | "stale";
      artifact: EvryClarificationArtifact;
    }>;

function containsAlias(text: string, alias: string): boolean {
  return ` ${text} `.includes(` ${alias} `);
}

function entityChoice(reference: EvryResolvedReference): EvryEntityChoice {
  return Object.freeze({
    entityType: reference.entityType,
    id: reference.entityId,
    label: reference.label,
    distinguishingFacts: reference.distinguishingFacts,
    sourceLink: trustedEvryApplicationSourceLink(reference.sourceLink),
  });
}

function choiceTuple(
  references: readonly EvryResolvedReference[]
): readonly [EvryEntityChoice, EvryEntityChoice, ...EvryEntityChoice[]] {
  const choices = references.map(entityChoice);
  const first = choices[0];
  const second = choices[1];
  if (!first || !second) {
    throw new Error("An Evry choice clarification needs at least two records");
  }
  return Object.freeze([first, second, ...choices.slice(2)]);
}

function missingArtifact(
  entityType: string,
  prompt: string
): EvryClarificationArtifact {
  return Object.freeze({
    kind: "clarification",
    mode: "missing",
    entityType,
    prompt,
  });
}

function relevanceKeyFor(
  reference: EvryResolvedReference
): EvryConversationRelevanceKey {
  return evryConversationRelevanceKeySchema.parse(reference.key);
}

/**
 * Resolve visible reference language from structured records and choices only.
 * Summary prose is deliberately absent from this function's inputs.
 */
export function resolveEvryConversationReference(input: {
  text: string;
  state: EvryConversationStateDocument;
  now: Date;
}): EvryConversationReferenceResolution {
  const normalized = normalizeEvryReferenceAlias(input.text);
  const aliasesInText = new Set<string>();
  for (const reference of input.state.resolvedReferences) {
    for (const alias of reference.aliases) {
      if (containsAlias(normalized, alias)) aliasesInText.add(alias);
    }
  }
  for (const pronoun of PRONOUNS) {
    if (containsAlias(normalized, pronoun)) aliasesInText.add(pronoun);
  }
  if (aliasesInText.size === 0) return { status: "not_applicable" };

  const candidates = input.state.resolvedReferences.filter((reference) =>
    reference.aliases.some((alias) => aliasesInText.has(alias))
  );
  const entityTypes = new Set(candidates.map(({ entityType }) => entityType));
  const entityType =
    entityTypes.size === 1 ? (candidates[0]?.entityType ?? "record") : "record";

  if (candidates.length === 0) {
    return {
      status: "clarification",
      reason: "missing",
      artifact: missingArtifact(
        entityType,
        "Which EveryField record do you mean?"
      ),
    };
  }

  const stale = candidates.filter(
    ({ validThrough }) =>
      validThrough !== null && Date.parse(validThrough) <= input.now.valueOf()
  );
  if (stale.length > 0) {
    return {
      status: "clarification",
      reason: "stale",
      artifact: missingArtifact(
        entityType,
        "That earlier record reference may be out of date. Which EveryField record should I use now?"
      ),
    };
  }

  if (candidates.length === 1) {
    return {
      status: "resolved",
      reference: candidates[0],
      relevanceKeys: Object.freeze([relevanceKeyFor(candidates[0])]),
    };
  }

  const candidateKeys = new Set(candidates.map(({ key }) => key));
  const selected = [...input.state.explicitChoices]
    .reverse()
    .find(({ referenceKey }) => candidateKeys.has(referenceKey));
  if (selected) {
    const reference = candidates.find(
      ({ key, entityId }) =>
        key === selected.referenceKey && entityId === selected.selectedEntityId
    );
    if (reference) {
      return {
        status: "resolved",
        reference,
        relevanceKeys: Object.freeze([relevanceKeyFor(reference)]),
      };
    }
  }

  return {
    status: "clarification",
    reason: "ambiguous",
    artifact: Object.freeze({
      kind: "clarification",
      mode: "choice",
      entityType,
      prompt: "Which EveryField record do you mean?",
      choices: choiceTuple(candidates),
      defaultChoiceId: null,
    }),
  };
}
