import type { Capability } from "@/lib/auth/seat-rules";

const EVRY_CAPABILITY_REGISTRY: unique symbol = Symbol(
  "EvryCapabilityRegistry"
);

export type EvryCapabilityOperationKind = "read" | "effect";

export type EvryCapabilityRegistration = Readonly<{
  identity: string;
  surfaceIdentities: readonly [string, ...string[]];
  parityCapability: string;
  operationKind: EvryCapabilityOperationKind;
  applicationCapability: Capability;
}>;

export type EvryReadCapabilityRegistration = EvryCapabilityRegistration &
  Readonly<{ operationKind: "read" }>;

export type EvryEffectCapabilityRegistration = EvryCapabilityRegistration &
  Readonly<{ operationKind: "effect" }>;

export type EvryCapabilityRegistry = Readonly<{
  registrationFor(identity: string): EvryCapabilityRegistration | null;
  registrationForSurface(
    surfaceIdentity: string
  ): EvryCapabilityRegistration | null;
  registrations(): readonly EvryCapabilityRegistration[];
  [EVRY_CAPABILITY_REGISTRY]: true;
}>;

export type EvryAuthoritativeCapabilitySurface = Readonly<{
  identity: string;
  capabilityIdentity: string;
  parityCapability: string;
  operationKind: EvryCapabilityOperationKind;
  applicationCapability: Capability;
}>;

const SEMANTIC_IDENTITY = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

/**
 * Define one semantic capability separately from its concrete product surfaces.
 * Operation kind controls confirmation; the application capability controls
 * the seat check. Neither fact is inferred from the other.
 */
export function defineEvryCapabilityRegistration(input: {
  identity: string;
  surfaceIdentities: readonly [string, ...string[]];
  parityCapability: string;
  operationKind: EvryCapabilityOperationKind;
  applicationCapability: Capability;
}): EvryCapabilityRegistration {
  if (!SEMANTIC_IDENTITY.test(input.identity)) {
    throw new Error(
      `Invalid semantic Evry capability identity: ${input.identity}`
    );
  }
  if (input.parityCapability.trim().length === 0) {
    throw new Error(`Evry capability ${input.identity} needs a parity family`);
  }
  const surfaces = [...input.surfaceIdentities];
  if (
    surfaces.some((surface) => surface.trim().length === 0) ||
    new Set(surfaces).size !== surfaces.length
  ) {
    throw new Error(
      `Evry capability ${input.identity} needs unique concrete surfaces`
    );
  }
  return Object.freeze({
    ...input,
    surfaceIdentities: Object.freeze(surfaces) as readonly [
      string,
      ...string[],
    ],
  });
}

/** Compose generated packs, refusing any duplicate semantic or source claim. */
export function createEvryCapabilityRegistry(
  input: Readonly<{
    registrations: readonly EvryCapabilityRegistration[];
    authoritativeSurfaces: readonly EvryAuthoritativeCapabilitySurface[];
  }>
): EvryCapabilityRegistry {
  const byIdentity = new Map<string, EvryCapabilityRegistration>();
  const bySurface = new Map<string, EvryCapabilityRegistration>();
  const authoritative = new Map<string, EvryAuthoritativeCapabilitySurface>();

  for (const surface of input.authoritativeSurfaces) {
    if (authoritative.has(surface.identity)) {
      throw new Error(
        `Duplicate authoritative Evry surface: ${surface.identity}`
      );
    }
    authoritative.set(surface.identity, surface);
  }

  for (const registration of input.registrations) {
    if (byIdentity.has(registration.identity)) {
      throw new Error(
        `Duplicate semantic Evry capability: ${registration.identity}`
      );
    }
    byIdentity.set(registration.identity, registration);
    for (const surface of registration.surfaceIdentities) {
      const source = authoritative.get(surface);
      if (!source) {
        throw new Error(
          `Evry capability ${registration.identity} claims unknown surface ${surface}`
        );
      }
      if (
        source.capabilityIdentity !== registration.identity ||
        source.parityCapability !== registration.parityCapability ||
        source.operationKind !== registration.operationKind ||
        source.applicationCapability !== registration.applicationCapability
      ) {
        throw new Error(
          `Evry capability ${registration.identity} conflicts with authoritative surface ${surface}`
        );
      }
      const existing = bySurface.get(surface);
      if (existing) {
        throw new Error(
          `Evry surface ${surface} is classified by both ${existing.identity} and ${registration.identity}`
        );
      }
      bySurface.set(surface, registration);
    }
  }

  const uncovered = [...authoritative.keys()].filter(
    (surface) => !bySurface.has(surface)
  );
  if (uncovered.length > 0) {
    throw new Error(
      `Uncovered authoritative Evry surfaces:\n${uncovered.join("\n")}`
    );
  }

  const ordered = Object.freeze([...byIdentity.values()]);
  return Object.freeze({
    registrationFor(identity: string) {
      return byIdentity.get(identity) ?? null;
    },
    registrationForSurface(surfaceIdentity: string) {
      return bySurface.get(surfaceIdentity) ?? null;
    },
    registrations() {
      return ordered;
    },
    [EVRY_CAPABILITY_REGISTRY]: true as const,
  });
}
