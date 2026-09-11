import {
  createEvryCapabilityRegistry,
  defineEvryCapabilityRegistration,
} from "@/lib/evry/eligibility/registry";

import {
  PLATFORM_AUTHORITATIVE_SURFACES,
  PLATFORM_CAPABILITIES,
} from "./catalog";

export const PLATFORM_CAPABILITY_REGISTRATIONS = Object.freeze(
  PLATFORM_CAPABILITIES.map((capability) =>
    defineEvryCapabilityRegistration({
      identity: capability.identity,
      surfaceIdentities: capability.surfaceIdentities,
      parityCapability: capability.parityCapability,
      operationKind: capability.operationKind,
      applicationCapability: capability.applicationCapability,
    })
  )
);

export const PLATFORM_CAPABILITY_REGISTRY = createEvryCapabilityRegistry({
  registrations: PLATFORM_CAPABILITY_REGISTRATIONS,
  authoritativeSurfaces: PLATFORM_AUTHORITATIVE_SURFACES,
});
