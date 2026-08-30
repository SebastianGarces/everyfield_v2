import {
  createEvryCapabilityRegistry,
  defineEvryCapabilityRegistration,
  type EvryCapabilityRegistration,
} from "@/lib/evry/eligibility/registry";

import {
  PLANT_INTELLIGENCE_AUTHORITATIVE_SURFACES,
  PLANT_INTELLIGENCE_CAPABILITIES,
} from "./catalog";

export const PLANT_INTELLIGENCE_CAPABILITY_REGISTRATIONS: readonly EvryCapabilityRegistration[] =
  Object.freeze(
    PLANT_INTELLIGENCE_CAPABILITIES.map((capability) =>
      defineEvryCapabilityRegistration({
        identity: capability.identity,
        surfaceIdentities: capability.surfaceIdentities,
        parityCapability: capability.parityCapability,
        operationKind: capability.operationKind,
        applicationCapability: capability.applicationCapability,
      })
    )
  );

/** Exact generated bijection: every supported /phase source is claimed once. */
export const PLANT_INTELLIGENCE_CAPABILITY_REGISTRY =
  createEvryCapabilityRegistry({
    registrations: PLANT_INTELLIGENCE_CAPABILITY_REGISTRATIONS,
    authoritativeSurfaces: PLANT_INTELLIGENCE_AUTHORITATIVE_SURFACES,
  });
