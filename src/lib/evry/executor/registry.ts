import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import { z } from "zod";
import {
  isEvryEffectCapabilityIdentity,
  type EvryEffectCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import {
  createEvryPlanCapabilityRegistry,
  type EvryJsonValue,
  type EvryPlanCapabilityRegistration,
  type EvryPlanCapabilityRegistry,
} from "@/lib/evry/plans";

const EVRY_EXECUTION_CAPABILITY: unique symbol = Symbol(
  "EvryExecutionCapability"
);
const EVRY_EXECUTION_REGISTRY: unique symbol = Symbol("EvryExecutionRegistry");
const POSTGRES_INT4_MAX = 2_147_483_647;

const countSchema = z
  .number()
  .safe()
  .int()
  .nonnegative()
  .max(POSTGRES_INT4_MAX);

const effectResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    affectedCount: countSchema,
    excludedCount: countSchema,
  }),
  z.strictObject({
    status: z.enum(["refused", "failed"]),
    excludedCount: countSchema,
  }),
  z.strictObject({ status: z.literal("retryable") }),
]);

const effectReconciliationSchema = z.union([
  effectResultSchema,
  z.strictObject({ status: z.literal("resume") }),
]);

export type EvryEffectResult = Readonly<z.infer<typeof effectResultSchema>>;
export type EvryEffectReconciliation = Readonly<
  z.infer<typeof effectReconciliationSchema>
>;

export type EvryEffectInput = Readonly<{
  authorization: EvryEffectCapabilityAuthorization;
  effectKey: EvryAuditKey;
  execution: Readonly<{
    attemptId: string;
    planId: string;
    actorUserId: string;
    plantId: string;
    fingerprint: string;
    correlationId: string;
    stepId: string;
    capabilityIdentity: string;
  }>;
  arguments: Readonly<Record<string, EvryJsonValue>>;
}>;

export type EvryClaimedEffectInput = Readonly<
  Omit<EvryEffectInput, "authorization">
>;

export type EvryExecutionCapabilityRegistration = Readonly<{
  planCapability: EvryPlanCapabilityRegistration;
  /**
   * First return an existing exact `effectKey` claim's original closed result.
   * `resume` means an irreversible boundary started before the final claim and
   * must continue from its immutable inputs after fresh capability authority,
   * even when ordinary plan freshness has elapsed. Raw errors must not cross.
   */
  executeIfCurrent(input: EvryEffectInput): Promise<EvryEffectResult>;
  /**
   * Reconcile a domain mutation that is already durably claimed. This runs
   * before fresh authorization because revoking later authority cannot turn an
   * already-committed mutation into a truthful refusal. `null` means no exact
   * claim exists and the ordinary authorized path must run.
   */
  reconcileClaimed?(
    input: EvryClaimedEffectInput
  ): Promise<EvryEffectReconciliation | null>;
  [EVRY_EXECUTION_CAPABILITY]: true;
}>;

export type EvryExecutionCapabilityRegistry = Readonly<{
  planRegistry: EvryPlanCapabilityRegistry;
  registrationFor(identity: string): EvryExecutionCapabilityRegistration | null;
  [EVRY_EXECUTION_REGISTRY]: true;
}>;

export function defineEvryExecutionCapability(input: {
  planCapability: EvryPlanCapabilityRegistration;
  executeIfCurrent(input: EvryEffectInput): Promise<EvryEffectResult>;
  reconcileClaimed?(
    input: EvryClaimedEffectInput
  ): Promise<EvryEffectReconciliation | null>;
}): EvryExecutionCapabilityRegistration {
  if (!isEvryEffectCapabilityIdentity(input.planCapability.identity)) {
    throw new Error(
      `Evry execution capability is not an authoritative effect: ${input.planCapability.identity}`
    );
  }
  return Object.freeze({
    planCapability: input.planCapability,
    async executeIfCurrent(effectInput: EvryEffectInput) {
      return effectResultSchema.parse(
        await input.executeIfCurrent(effectInput)
      );
    },
    ...(input.reconcileClaimed
      ? {
          async reconcileClaimed(effectInput: EvryClaimedEffectInput) {
            const result = await input.reconcileClaimed!(effectInput);
            return result === null
              ? null
              : effectReconciliationSchema.parse(result);
          },
        }
      : {}),
    [EVRY_EXECUTION_CAPABILITY]: true as const,
  });
}

/** Assemble one trusted effect table and its matching plan parser. */
export function createEvryExecutionCapabilityRegistry(
  registrations: readonly EvryExecutionCapabilityRegistration[]
): EvryExecutionCapabilityRegistry {
  const byIdentity = new Map<string, EvryExecutionCapabilityRegistration>();

  for (const registration of registrations) {
    const identity = registration.planCapability.identity;
    if (!isEvryEffectCapabilityIdentity(identity)) {
      throw new Error(
        `Evry execution capability is not an authoritative effect: ${identity}`
      );
    }
    if (byIdentity.has(identity)) {
      throw new Error(
        `Duplicate Evry execution capability identity: ${identity}`
      );
    }
    byIdentity.set(identity, registration);
  }

  return Object.freeze({
    planRegistry: createEvryPlanCapabilityRegistry(
      registrations.map(({ planCapability }) => planCapability)
    ),
    registrationFor(identity: string) {
      return byIdentity.get(identity) ?? null;
    },
    [EVRY_EXECUTION_REGISTRY]: true as const,
  });
}
