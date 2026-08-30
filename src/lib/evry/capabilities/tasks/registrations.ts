import {
  createEvryCapabilityRegistry,
  defineEvryCapabilityRegistration,
  type EvryCapabilityRegistration,
} from "@/lib/evry/eligibility/registry";

import { TASK_AUTHORITATIVE_SURFACES, TASK_CAPABILITIES } from "./catalog";

export const TASK_CAPABILITY_REGISTRATIONS: readonly EvryCapabilityRegistration[] =
  Object.freeze(
    TASK_CAPABILITIES.map((capability) =>
      defineEvryCapabilityRegistration({
        identity: capability.identity,
        surfaceIdentities: capability.surfaceIdentities,
        parityCapability: "tasks",
        operationKind: capability.operationKind,
        applicationCapability: capability.applicationCapability,
      })
    )
  );

/** Closed pack proof: every generated source surface is claimed exactly once. */
export const TASK_CAPABILITY_REGISTRY = createEvryCapabilityRegistry({
  registrations: TASK_CAPABILITY_REGISTRATIONS,
  authoritativeSurfaces: TASK_AUTHORITATIVE_SURFACES,
});
