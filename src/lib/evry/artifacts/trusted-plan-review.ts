import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type {
  EvryActionPlanDocument,
  EvryPlanCapabilityRegistry,
} from "@/lib/evry/plans";
import { validateStoredEvryActionPlan } from "@/lib/evry/plans/integrity";
import { findExactEvryActionPlan } from "@/lib/evry/plans/repository";
import { parseStoredEvryActionPlan } from "@/lib/evry/plans/schema";
import { storedDocumentMatchesEvryRecipe } from "@/lib/evry/recipes/contract";
import type { EvryRecipeRegistry } from "@/lib/evry/recipes/schema";
import {
  evryConversationPlanIdentitySchema,
  type EvryConversationPlanIdentity,
} from "@/lib/evry/conversations/contract";

import type { EvryTrustedPlanReview } from "./lifecycle";
import {
  deepFreezeEvryArtifact,
  evryDetailedConfirmationArtifactDocumentSchema,
  type EvryDetailedConfirmationArtifactDocument,
} from "./review";

const EVRY_ARTIFACT_REVIEW_REGISTRATION: unique symbol = Symbol(
  "EvryArtifactReviewRegistration"
);
const EVRY_ARTIFACT_REVIEW_REGISTRY: unique symbol = Symbol(
  "EvryArtifactReviewRegistry"
);

export type EvryArtifactReviewRegistration = Readonly<{
  source:
    | Readonly<{
        kind: "recipe";
        identity: string;
        registry: EvryRecipeRegistry;
      }>
    | Readonly<{
        kind: "generic";
        capabilityIdentities: readonly [string, ...string[]];
      }>;
  build(input: {
    plan: EvryConversationPlanIdentity;
    document: EvryActionPlanDocument;
  }): EvryDetailedConfirmationArtifactDocument;
  [EVRY_ARTIFACT_REVIEW_REGISTRATION]: true;
}>;

export type EvryArtifactReviewRegistry = Readonly<{
  registrationFor(
    document: EvryActionPlanDocument
  ): EvryArtifactReviewRegistration | null;
  [EVRY_ARTIFACT_REVIEW_REGISTRY]: true;
}>;

/** Register application-owned rich disclosure derived from one trusted recipe. */
export function defineEvryArtifactReview(input: {
  source:
    | Readonly<{
        kind: "recipe";
        identity: string;
        registry: EvryRecipeRegistry;
      }>
    | Readonly<{
        kind: "generic";
        capabilityIdentities: readonly [string, ...string[]];
      }>;
  build(input: {
    plan: EvryConversationPlanIdentity;
    document: EvryActionPlanDocument;
  }): EvryDetailedConfirmationArtifactDocument;
}): EvryArtifactReviewRegistration {
  const identities =
    input.source.kind === "recipe"
      ? [input.source.identity]
      : input.source.capabilityIdentities;
  if (identities.some((identity) => identity.trim().length === 0)) {
    throw new Error("An Evry artifact review needs source identities");
  }
  if (
    input.source.kind === "recipe" &&
    !input.source.registry.registrationFor(input.source.identity)
  ) {
    throw new Error("An Evry artifact review needs a live registered recipe");
  }
  let source: EvryArtifactReviewRegistration["source"];
  if (input.source.kind === "recipe") {
    source = Object.freeze({ ...input.source });
  } else {
    const capabilityIdentities: [string, ...string[]] = [
      input.source.capabilityIdentities[0],
      ...input.source.capabilityIdentities.slice(1),
    ];
    source = Object.freeze({
      kind: "generic",
      capabilityIdentities: Object.freeze(capabilityIdentities),
    });
  }
  return Object.freeze({
    source,
    build: input.build,
    [EVRY_ARTIFACT_REVIEW_REGISTRATION]: true as const,
  });
}

function reviewSourceKey(
  source: EvryArtifactReviewRegistration["source"]
): string {
  return source.kind === "recipe"
    ? `recipe:${source.identity}`
    : `generic:${JSON.stringify(source.capabilityIdentities)}`;
}

function documentReviewSource(
  document: EvryActionPlanDocument
): EvryArtifactReviewRegistration["source"] {
  if (document.recipe) {
    throw new Error("Recipe sources require their live trusted registry");
  }
  return {
    kind: "generic",
    capabilityIdentities: [
      document.steps[0].capabilityIdentity,
      ...document.steps
        .slice(1)
        .map(({ capabilityIdentity }) => capabilityIdentity),
    ],
  };
}

export function createEvryArtifactReviewRegistry(
  registrations: readonly EvryArtifactReviewRegistration[]
): EvryArtifactReviewRegistry {
  const byIdentity = new Map<string, EvryArtifactReviewRegistration>();
  for (const registration of registrations) {
    const key = reviewSourceKey(registration.source);
    if (byIdentity.has(key)) {
      throw new Error(`Duplicate Evry artifact review source: ${key}`);
    }
    byIdentity.set(key, registration);
  }
  return Object.freeze({
    registrationFor(document: EvryActionPlanDocument) {
      const key = document.recipe
        ? `recipe:${document.recipe.identity}`
        : reviewSourceKey(documentReviewSource(document));
      return byIdentity.get(key) ?? null;
    },
    [EVRY_ARTIFACT_REVIEW_REGISTRY]: true as const,
  });
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Bind every browser-visible field to application code while also proving the
 * recipe's fingerprinted title, targets, and consequences were not replaced.
 */
export function trustedReviewForEvryPlanDocument(input: {
  plan: EvryConversationPlanIdentity;
  document: EvryActionPlanDocument;
  reviewRegistry: EvryArtifactReviewRegistry;
}): EvryTrustedPlanReview | null {
  const planConfirmation = input.document.confirmation;
  if (
    (input.document.recipe && !planConfirmation) ||
    (!input.document.recipe &&
      (planConfirmation !== undefined ||
        input.document.steps.some(
          ({ disclosure }) => disclosure !== undefined
        )))
  ) {
    return null;
  }
  const registration = input.reviewRegistry.registrationFor(input.document);
  if (!registration) return null;
  if (input.document.recipe) {
    if (registration.source.kind !== "recipe") return null;
    const definition = registration.source.registry.registrationFor(
      input.document.recipe.identity
    );
    if (
      !definition ||
      !storedDocumentMatchesEvryRecipe({
        definition,
        document: input.document,
      })
    ) {
      return null;
    }
  } else if (registration.source.kind !== "generic") {
    return null;
  }

  try {
    const confirmation = evryDetailedConfirmationArtifactDocumentSchema.parse(
      registration.build({ plan: input.plan, document: input.document })
    );
    if (
      confirmation.plan.planId !== input.plan.planId ||
      confirmation.plan.fingerprint !== input.plan.fingerprint ||
      confirmation.steps.length !== input.document.steps.length
    ) {
      return null;
    }

    const expectedConsequences: string[] = [];
    for (const [index, step] of input.document.steps.entries()) {
      const disclosure = step.disclosure;
      const displayed = confirmation.steps[index];
      if (!displayed || displayed.stepId !== step.id) {
        return null;
      }
      if (disclosure) {
        if (
          displayed.title !== disclosure.title ||
          displayed.resolvedTargets.length !== disclosure.items.length ||
          !displayed.resolvedTargets.every(
            (target, targetIndex) =>
              target.label === disclosure.items[targetIndex]?.label &&
              target.value === disclosure.items[targetIndex]?.value
          )
        ) {
          return null;
        }
        expectedConsequences.push(...disclosure.consequences);
      }
    }
    if (
      planConfirmation &&
      (confirmation.title !== planConfirmation.title ||
        confirmation.actionLabel !== planConfirmation.actionLabel ||
        !sameStrings(confirmation.consequences, expectedConsequences))
    ) {
      return null;
    }
    return Object.freeze({
      confirmation: deepFreezeEvryArtifact(confirmation),
      source:
        registration.source.kind === "recipe"
          ? Object.freeze({
              kind: "recipe" as const,
              identity: registration.source.identity,
            })
          : Object.freeze({ kind: "generic" as const }),
    });
  } catch {
    return null;
  }
}

const REVIEWABILITY_PROBE_PLAN = evryConversationPlanIdentitySchema.parse({
  planId: "00000000-0000-4000-8000-000000000001",
  fingerprint: "0".repeat(64),
});

/**
 * Prove an internally compiled document can produce its complete trusted
 * review before any repository call makes that document durable.
 */
export function assertEvryPlanDocumentReviewable(input: {
  document: EvryActionPlanDocument;
  reviewRegistry: EvryArtifactReviewRegistry;
}): void {
  if (
    !trustedReviewForEvryPlanDocument({
      plan: REVIEWABILITY_PROBE_PLAN,
      document: input.document,
      reviewRegistry: input.reviewRegistry,
    })
  ) {
    throw new Error("Evry plan document has no complete trusted review");
  }
}

/** Reopen the exact fingerprinted plan and project only its trusted disclosure. */
export async function trustedEvryPlanReview(input: {
  actor: EvryPlantActor;
  plan: EvryConversationPlanIdentity;
  registry: EvryPlanCapabilityRegistry;
  reviewRegistry: EvryArtifactReviewRegistry;
}): Promise<EvryTrustedPlanReview | null> {
  const stored = await findExactEvryActionPlan({
    planId: input.plan.planId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint: input.plan.fingerprint,
  });
  if (!stored || !validateStoredEvryActionPlan(stored, input.registry)) {
    return null;
  }
  try {
    const document = parseStoredEvryActionPlan({
      document: stored.document,
      registry: input.registry,
    });
    return trustedReviewForEvryPlanDocument({
      plan: input.plan,
      document,
      reviewRegistry: input.reviewRegistry,
    });
  } catch {
    return null;
  }
}
