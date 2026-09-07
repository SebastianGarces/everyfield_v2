import inventory from "./inventory.generated.json";

import type { Capability } from "@/lib/auth/seat-rules";
import type { EvryAuthoritativeCapabilitySurface } from "@/lib/evry/eligibility/registry";

export type PlatformCapability = Readonly<{
  identity: string;
  surfaceIdentities: readonly [string, ...string[]];
  parityCapability: string;
  domain: "dashboard" | "notifications" | "feedback";
  operationKind: "read" | "effect";
  applicationCapability: Capability;
  confirmation: "not_required" | "required";
  mutationShape: "single_update" | "bulk_update" | "single_create" | null;
}>;

export const PLATFORM_CAPABILITIES: readonly PlatformCapability[] =
  Object.freeze(
    inventory.capabilities.map((capability) => {
      const [first, ...rest] = capability.surfaceIdentities;
      if (!first) throw new Error(`Platform capability has no surface`);
      return Object.freeze({
        ...capability,
        surfaceIdentities: Object.freeze([first, ...rest]) as readonly [
          string,
          ...string[],
        ],
      }) as PlatformCapability;
    })
  );

export const PLATFORM_AUTHORITATIVE_SURFACES: readonly EvryAuthoritativeCapabilitySurface[] =
  Object.freeze(
    inventory.entries.flatMap((entry) => {
      if (
        entry.classification.state !== "supported" ||
        (entry.operationKind !== "read" && entry.operationKind !== "effect") ||
        entry.applicationCapability === null
      ) {
        return [];
      }
      return [
        Object.freeze({
          identity: entry.identity,
          capabilityIdentity: entry.capabilityIdentity,
          parityCapability:
            entry.domain === "feedback" ? "product-feedback" : entry.domain,
          operationKind: entry.operationKind,
          applicationCapability: entry.applicationCapability as Capability,
        }),
      ];
    })
  );
