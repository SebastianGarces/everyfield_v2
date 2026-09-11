import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";
import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";
import type { EvryActionPlanDocument } from "@/lib/evry/plans";
import { storedDocumentMatchesEvryRecipe } from "@/lib/evry/recipes/contract";
import type { EvryRecipeRegistry } from "@/lib/evry/recipes/schema";

const EVRY_RECIPE_REUSE_REGISTRATION: unique symbol = Symbol(
  "EvryRecipeReuseRegistration"
);

export type EvryRecipeReuseDraft = Readonly<{
  recipeIdentity: string;
  message: string;
}>;

export type EvryRecipeReuseRegistration = Readonly<{
  identity: string;
  recipeRegistry: EvryRecipeRegistry;
  project(input: {
    conversation: EvryStoredConversation;
    plan: EvryConversationPlanIdentity;
  }): EvryRecipeReuseDraft | null;
  [EVRY_RECIPE_REUSE_REGISTRATION]: true;
}>;

export function defineEvryRecipeReuse(input: {
  identity: string;
  recipeRegistry: EvryRecipeRegistry;
  project(input: {
    conversation: EvryStoredConversation;
    plan: EvryConversationPlanIdentity;
  }): EvryRecipeReuseDraft | null;
}): EvryRecipeReuseRegistration {
  if (
    !input.recipeRegistry.registrationFor(input.identity) ||
    input.identity.trim().length === 0
  ) {
    throw new Error("An Evry reuse projection needs a registered recipe");
  }
  return Object.freeze({
    ...input,
    [EVRY_RECIPE_REUSE_REGISTRATION]: true as const,
  });
}

export type EvryRecipeReuseRegistry = Readonly<{
  identities: ReadonlySet<string>;
  project(input: {
    conversation: EvryStoredConversation;
    plan: EvryConversationPlanIdentity;
    document: EvryActionPlanDocument;
  }): EvryRecipeReuseDraft | null;
}>;

export function createEvryRecipeReuseRegistry(
  registrations: readonly EvryRecipeReuseRegistration[]
): EvryRecipeReuseRegistry {
  const byIdentity = new Map<string, EvryRecipeReuseRegistration>();
  for (const registration of registrations) {
    if (byIdentity.has(registration.identity)) {
      throw new Error(`Duplicate Evry recipe reuse: ${registration.identity}`);
    }
    byIdentity.set(registration.identity, registration);
  }
  return Object.freeze({
    identities: new Set(byIdentity.keys()),
    project(input) {
      const identity = input.document.recipe?.identity;
      if (!identity) return null;
      const registration = byIdentity.get(identity);
      const definition = registration?.recipeRegistry.registrationFor(identity);
      if (
        !registration ||
        !definition ||
        !storedDocumentMatchesEvryRecipe({
          definition,
          document: input.document,
        })
      ) {
        return null;
      }
      const draft = registration.project({
        conversation: input.conversation,
        plan: input.plan,
      });
      return draft?.recipeIdentity === identity ? draft : null;
    },
  });
}
