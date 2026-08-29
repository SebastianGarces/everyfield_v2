import {
  EVRY_CAPABILITY_EVAL_LAYERS,
  type EvryCapabilityEvalLayer,
} from "@/lib/evry/evals/contracts";

import { MEETINGS_OPERATION_REGISTRATIONS } from "./registrations";

export type MeetingsCapabilityEvalFixture = Readonly<{
  capabilityIdentity: string;
  operationKind: "read" | "effect";
  expectsConfirmation: boolean;
  cases: Readonly<
    Record<
      EvryCapabilityEvalLayer,
      readonly [Readonly<{ id: string; proofId: "meetings-capability-contract" }>]
    >
  >;
}>;

function casesFor(identity: string): MeetingsCapabilityEvalFixture["cases"] {
  return Object.freeze(
    Object.fromEntries(
      EVRY_CAPABILITY_EVAL_LAYERS.map((layer) => [
        layer,
        Object.freeze([
          Object.freeze({
            id: `${identity}:${layer}`,
            proofId: "meetings-capability-contract" as const,
          }),
        ]),
      ])
    ) as MeetingsCapabilityEvalFixture["cases"]
  );
}

/**
 * Derived from production registrations: adding a Meetings operation creates
 * ten missing named proof cases in the same diff instead of relying on a
 * separately maintained release roster.
 */
export const MEETINGS_CAPABILITY_EVAL_FIXTURES: readonly MeetingsCapabilityEvalFixture[] =
  Object.freeze(
    MEETINGS_OPERATION_REGISTRATIONS.map((registration) =>
      Object.freeze({
        capabilityIdentity: registration.identity,
        operationKind: registration.operationKind,
        expectsConfirmation: registration.operationKind === "effect",
        cases: casesFor(registration.identity),
      })
    )
  );
