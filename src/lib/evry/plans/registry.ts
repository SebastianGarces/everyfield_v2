import { z } from "zod";

export const EVRY_EFFECT_CLASSES = [
  "database_write",
  "file_storage_write",
  "outbound_communication",
  "external_side_effect",
] as const;

export type EvryEffectClass = (typeof EVRY_EFFECT_CLASSES)[number];

const EVRY_PLAN_CAPABILITY: unique symbol = Symbol("EvryPlanCapability");
const EVRY_PLAN_REGISTRY: unique symbol = Symbol("EvryPlanRegistry");

export type EvryPlanCapabilityRegistration = Readonly<{
  identity: string;
  effectClass: EvryEffectClass;
  argumentsSchema: z.ZodType<Record<string, unknown>>;
  [EVRY_PLAN_CAPABILITY]: true;
}>;

export type EvryPlanCapabilityRegistry = Readonly<{
  registrationFor(identity: string): EvryPlanCapabilityRegistration | null;
  [EVRY_PLAN_REGISTRY]: true;
}>;

/**
 * Register one lasting application effect with a closed argument object.
 *
 * Callers provide the fields, not an arbitrary object schema. This function
 * owns the strict boundary, so a capability pack cannot accidentally accept
 * model-supplied keys it never declared.
 */
export function defineEvryPlanCapability<Shape extends z.ZodRawShape>(input: {
  identity: string;
  effectClass: EvryEffectClass;
  arguments: Shape;
}): EvryPlanCapabilityRegistration {
  if (input.identity.length === 0) {
    throw new Error("An Evry plan capability needs an identity");
  }

  return Object.freeze({
    identity: input.identity,
    effectClass: input.effectClass,
    argumentsSchema: z.strictObject(input.arguments) as z.ZodType<
      Record<string, unknown>
    >,
    [EVRY_PLAN_CAPABILITY]: true as const,
  });
}

/** Register a trusted closed union when one authoritative effect has variants. */
export function defineEvryPlanCapabilitySchema(input: {
  identity: string;
  effectClass: EvryEffectClass;
  argumentsSchema: z.ZodType<Record<string, unknown>>;
}): EvryPlanCapabilityRegistration {
  if (input.identity.length === 0) {
    throw new Error("An Evry plan capability needs an identity");
  }
  return Object.freeze({
    identity: input.identity,
    effectClass: input.effectClass,
    argumentsSchema: input.argumentsSchema,
    [EVRY_PLAN_CAPABILITY]: true as const,
  });
}

/** One closed lookup table, assembled from trusted capability-pack code. */
export function createEvryPlanCapabilityRegistry(
  registrations: readonly EvryPlanCapabilityRegistration[]
): EvryPlanCapabilityRegistry {
  const byIdentity = new Map<string, EvryPlanCapabilityRegistration>();

  for (const registration of registrations) {
    if (byIdentity.has(registration.identity)) {
      throw new Error(
        `Duplicate Evry plan capability identity: ${registration.identity}`
      );
    }
    byIdentity.set(registration.identity, registration);
  }

  return Object.freeze({
    registrationFor(identity: string) {
      return byIdentity.get(identity) ?? null;
    },
    [EVRY_PLAN_REGISTRY]: true as const,
  });
}
