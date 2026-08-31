import { evryDetailedReceiptArtifactDocumentSchema } from "@/lib/evry/artifacts/review";
import { PRODUCTION_EVRY_PLAN_REGISTRY } from "@/lib/evry/capabilities/production";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  parseStoredEvryActionPlan,
  type EvryPlanCapabilityRegistry,
} from "@/lib/evry/plans";
import { validateStoredEvryActionPlan } from "@/lib/evry/plans/integrity";
import { findExactEvryActionPlan } from "@/lib/evry/plans/repository";
import { PRODUCTION_EVRY_RECIPE_REUSE_REGISTRY } from "@/lib/evry/recipes/production-reuse";
import type { EvryRecipeReuseRegistry } from "@/lib/evry/recipes/reuse";
import type { EvryConversationStreamStage } from "@/lib/evry/streaming/conversation-wire";
import { z } from "zod";

import {
  evryConversationIdSchema,
  evryConversationRequestKeySchema,
} from "./contract";
import {
  evryConversationStore,
  createEvryConversation,
  type EvryConversationStore,
  type EvryResumedConversation,
} from "./service";

const artifactIdSchema = z.string().uuid();

type ReuseBoundaries = Readonly<{
  store: EvryConversationStore;
  findPlan: typeof findExactEvryActionPlan;
  create: typeof createEvryConversation;
  registry: EvryRecipeReuseRegistry;
  planRegistry: EvryPlanCapabilityRegistry;
}>;

const productionBoundaries: ReuseBoundaries = Object.freeze({
  store: evryConversationStore,
  findPlan: findExactEvryActionPlan,
  create: createEvryConversation,
  registry: PRODUCTION_EVRY_RECIPE_REUSE_REGISTRY,
  planRegistry: PRODUCTION_EVRY_PLAN_REGISTRY,
});

export type EvryCompletedRecipeReuseResult =
  | Readonly<{
      status: "created";
      resumed: EvryResumedConversation;
      copiedIntent: string;
    }>
  | Readonly<{ status: "unavailable" }>;

function carriesPlanIdentity(
  resumed: EvryResumedConversation,
  sourcePlan: Readonly<{ planId: string; fingerprint: string }>
) {
  if (
    resumed.conversation.activePlan?.planId === sourcePlan.planId ||
    resumed.conversation.activePlan?.fingerprint === sourcePlan.fingerprint
  ) {
    return true;
  }
  return resumed.conversation.messages.some((message) =>
    message.artifacts.some(
      ({ document }) =>
        (document.kind === "confirmation" ||
          document.kind === "progress" ||
          document.kind === "result") &&
        (document.plan.planId === sourcePlan.planId ||
          document.plan.fingerprint === sourcePlan.fingerprint)
    )
  );
}

function appendCarriesPlanIdentity(
  input: Parameters<EvryConversationStore["append"]>[0],
  sourcePlan: Readonly<{ planId: string; fingerprint: string }>
): boolean {
  if (
    input.activePlan?.mode === "set" &&
    (input.activePlan.plan.planId === sourcePlan.planId ||
      input.activePlan.plan.fingerprint === sourcePlan.fingerprint)
  ) {
    return true;
  }
  return input.artifacts.some(
    (document) =>
      (document.kind === "confirmation" ||
        document.kind === "progress" ||
        document.kind === "result") &&
      (document.plan.planId === sourcePlan.planId ||
        document.plan.fingerprint === sourcePlan.fingerprint)
  );
}

class EvryReuseSourcePlanCrossoverError extends Error {}

export function createCompletedEvryRecipeReuse(
  boundaries: ReuseBoundaries = productionBoundaries
) {
  return async function reuse(input: {
    actor: EvryPlantActor;
    sourceConversationId: string;
    resultArtifactId: string;
    recipeIdentity: string;
    requestKey: string;
    now: Date;
    reportStage?: (stage: EvryConversationStreamStage) => void | Promise<void>;
  }): Promise<EvryCompletedRecipeReuseResult> {
    const sourceConversationId = evryConversationIdSchema.safeParse(
      input.sourceConversationId
    );
    const resultArtifactId = artifactIdSchema.safeParse(input.resultArtifactId);
    const requestKey = evryConversationRequestKeySchema.safeParse(
      input.requestKey
    );
    if (
      !sourceConversationId.success ||
      !resultArtifactId.success ||
      !requestKey.success
    ) {
      return { status: "unavailable" };
    }
    const source = await boundaries.store.find({
      conversationId: sourceConversationId.data,
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
    });
    if (!source) return { status: "unavailable" };
    const storedArtifact = source.messages
      .flatMap(({ artifacts }) => artifacts)
      .find(({ id }) => id === resultArtifactId.data);
    const receipt = evryDetailedReceiptArtifactDocumentSchema.safeParse(
      storedArtifact?.document
    );
    if (
      !receipt.success ||
      receipt.data.status !== "completed" ||
      !receipt.data.reuse ||
      receipt.data.reuse.recipeIdentity !== input.recipeIdentity
    ) {
      return { status: "unavailable" };
    }
    await input.reportStage?.("resolving_references");
    const storedPlan = await boundaries.findPlan({
      planId: receipt.data.plan.planId,
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      fingerprint: receipt.data.plan.fingerprint,
    });
    if (
      !storedPlan ||
      storedPlan.status !== "completed" ||
      !validateStoredEvryActionPlan(storedPlan, boundaries.planRegistry)
    ) {
      return { status: "unavailable" };
    }
    let document;
    try {
      document = parseStoredEvryActionPlan({
        document: storedPlan.document,
        registry: boundaries.planRegistry,
      });
    } catch {
      return { status: "unavailable" };
    }
    if (document.recipe?.identity !== receipt.data.reuse.recipeIdentity) {
      return { status: "unavailable" };
    }
    const draft = boundaries.registry.project({
      conversation: source,
      plan: receipt.data.plan,
      document,
    });
    if (!draft) return { status: "unavailable" };
    const guardedStore: EvryConversationStore = Object.freeze({
      ...boundaries.store,
      append: async (appendInput) => {
        if (appendCarriesPlanIdentity(appendInput, receipt.data.plan)) {
          throw new EvryReuseSourcePlanCrossoverError();
        }
        return boundaries.store.append(appendInput);
      },
    });
    let resumed: EvryResumedConversation;
    try {
      resumed = await boundaries.create({
        actor: input.actor,
        requestKey: requestKey.data,
        message: draft.message,
        pageContext: null,
        requestPageContext: null,
        now: input.now,
        store: guardedStore,
        reportStage: input.reportStage,
      });
    } catch (error) {
      if (error instanceof EvryReuseSourcePlanCrossoverError) {
        return { status: "unavailable" };
      }
      throw error;
    }
    if (
      resumed.conversation.id === source.id ||
      carriesPlanIdentity(resumed, receipt.data.plan)
    ) {
      return { status: "unavailable" };
    }
    return Object.freeze({
      status: "created" as const,
      resumed,
      copiedIntent: draft.message,
    });
  };
}

export const reuseCompletedEvryRecipe = createCompletedEvryRecipeReuse();
