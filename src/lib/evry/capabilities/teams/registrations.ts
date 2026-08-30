import {
  createEvryCapabilityRegistry,
  defineEvryCapabilityRegistration,
  type EvryCapabilityRegistration,
} from "@/lib/evry/eligibility/registry";

import { TEAMS_AUTHORITATIVE_SURFACES, TEAMS_CAPABILITIES } from "./catalog";

export const TEAMS_CAPABILITY_REGISTRATIONS: readonly EvryCapabilityRegistration[] =
  Object.freeze(
    TEAMS_CAPABILITIES.map((capability) =>
      defineEvryCapabilityRegistration({
        identity: capability.identity,
        surfaceIdentities: capability.surfaceIdentities,
        parityCapability: "teams",
        operationKind: capability.operationKind,
        applicationCapability: capability.applicationCapability,
      })
    )
  );

/** Closed pack proof: every generated Teams surface is claimed exactly once. */
export const TEAMS_CAPABILITY_REGISTRY = createEvryCapabilityRegistry({
  registrations: TEAMS_CAPABILITY_REGISTRATIONS,
  authoritativeSurfaces: TEAMS_AUTHORITATIVE_SURFACES,
});
