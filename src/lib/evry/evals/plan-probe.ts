import { z } from "zod";

import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryActionPlanDocument } from "@/lib/evry/plans";
import { createEvryRecipeCompiler } from "@/lib/evry/recipes/compiler";
import {
  createFixtureRecipeRegistry,
  FIXTURE_RECIPE_VALUES,
  RECIPE_IDENTITY,
} from "@/lib/evry/recipes/fixtures.test-helper";

export const EVRY_PLAN_PROBE_ID = "meeting-invitation-reference" as const;
export const EVRY_PLAN_PROBE_RECIPE_ID = RECIPE_IDENTITY;
export const EVRY_PLAN_PROBE_SYSTEM_PROMPT =
  "You are the Evry controlled plan compiler. Select only a registered recipe and copy only supplied trusted identifiers and arguments. Never add work or prose.";

export const EVRY_PLAN_PROBE_PROMPT = `Select and fill the one registered Evry recipe for this controlled release probe. Return only the structured object.

Registered recipe: ${RECIPE_IDENTITY}
Known meeting id: ${FIXTURE_RECIPE_VALUES.meeting_id}
Known start: ${FIXTURE_RECIPE_VALUES.starts_at}
Audience expression to resolve: ${FIXTURE_RECIPE_VALUES.person_ids}
Known recipient id: ${FIXTURE_RECIPE_VALUES.recipient_ids[0]}
Subject: ${FIXTURE_RECIPE_VALUES.subject}
Body: ${FIXTURE_RECIPE_VALUES.body}

User request: Create the Vision Meeting at the known time, add Alex and Beth as guests, and email the known recipient.`;

export const evryPlanProbeProviderOutputSchema = z
  .object({
    recipeIdentity: z.literal(RECIPE_IDENTITY),
    meetingId: z.literal(FIXTURE_RECIPE_VALUES.meeting_id),
    startsAt: z.literal(FIXTURE_RECIPE_VALUES.starts_at),
    audience: z.literal(FIXTURE_RECIPE_VALUES.person_ids),
    recipientId: z.literal(FIXTURE_RECIPE_VALUES.recipient_ids[0]),
    subject: z.literal(FIXTURE_RECIPE_VALUES.subject),
    body: z.literal(FIXTURE_RECIPE_VALUES.body),
  })
  .strict();

export type EvryPlanProbeProviderOutput = z.infer<
  typeof evryPlanProbeProviderOutputSchema
>;

const ACTOR = {
  userId: "40000000-0000-4000-8000-000000000001",
  plantId: "50000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;

const READ_AUTHORIZATION = {
  actor: ACTOR,
  registration: {
    identity: "people.crm.people.load-more-people",
    parityCapability: "people.read",
    applicationCapability: "read",
  },
} as unknown as EvryReadCapabilityAuthorization;

/** Compile candidate-owned structured recipe arguments through real boundaries. */
export async function compileEvryPlanProbe(
  output: EvryPlanProbeProviderOutput
): Promise<EvryActionPlanDocument> {
  const registry = createFixtureRecipeRegistry();
  const definition = registry.registrationFor(output.recipeIdentity);
  if (!definition)
    throw new Error("Evry plan probe selected an unknown recipe");
  const compile = createEvryRecipeCompiler({
    async authorizeResolver() {
      return READ_AUTHORIZATION;
    },
  });
  const compiled = await compile({
    actor: ACTOR,
    registry,
    recipeIdentity: output.recipeIdentity,
    inputValues: {
      meeting_id: output.meetingId,
      starts_at: output.startsAt,
      person_ids: output.audience,
      recipient_ids: [output.recipientId],
      subject: output.subject,
      body: output.body,
    },
    eligibleCapabilities: definition.eligibleCapabilities.map((identity) => ({
      identity,
    })),
  });
  return compiled.document;
}
