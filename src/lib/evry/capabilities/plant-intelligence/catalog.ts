import type { Capability } from "@/lib/auth/seat-rules";
import type { EvryAuthoritativeCapabilitySurface } from "@/lib/evry/eligibility/registry";

import inventoryDocument from "./inventory.generated.json";

type GeneratedCapability = Readonly<{
  identity: string;
  surfaceIdentities: readonly string[];
  parityCapability: "plant-intelligence";
  domain: string;
  operationKind: "read" | "effect";
  applicationCapability: Capability;
  confirmation: "not_required" | "required";
}>;

type GeneratedEntry = Readonly<{
  identity: string;
  capabilityIdentity: string | null;
  operationKind: "read" | "effect" | "excluded";
  applicationCapability: Capability | null;
  classification:
    | Readonly<{ state: "supported" }>
    | Readonly<{ state: "excluded"; reason: string }>;
}>;

const inventory = inventoryDocument as Readonly<{
  capabilities: readonly GeneratedCapability[];
  entries: readonly GeneratedEntry[];
}>;

export const PLANT_INTELLIGENCE_CAPABILITIES = Object.freeze(
  inventory.capabilities.map((capability) => {
    const [first, ...rest] = capability.surfaceIdentities;
    if (!first)
      throw new Error(
        `Plant Intelligence capability ${capability.identity} has no source surface`
      );
    return Object.freeze({
      ...capability,
      surfaceIdentities: Object.freeze([first, ...rest]) as readonly [
        string,
        ...string[],
      ],
    });
  })
);

export const PLANT_INTELLIGENCE_AUTHORITATIVE_SURFACES: readonly EvryAuthoritativeCapabilitySurface[] =
  Object.freeze(
    inventory.entries.flatMap((entry) => {
      if (
        entry.classification.state !== "supported" ||
        entry.capabilityIdentity === null ||
        entry.applicationCapability === null ||
        entry.operationKind === "excluded"
      )
        return [];
      return [
        Object.freeze({
          identity: entry.identity,
          capabilityIdentity: entry.capabilityIdentity,
          parityCapability: "plant-intelligence",
          operationKind: entry.operationKind,
          applicationCapability: entry.applicationCapability,
        }),
      ];
    })
  );

export const PLANT_INTELLIGENCE_READ_IDENTITIES = Object.freeze({
  assessments: "plant-intelligence.assessments.read",
  attestations: "plant-intelligence.attestations.read",
  checkins: "plant-intelligence.checkins.read",
  declarations: "plant-intelligence.declarations.read",
  feedback: "plant-intelligence.feedback.read",
  signals: "plant-intelligence.signals.read",
} as const);

export const PLANT_INTELLIGENCE_EFFECT_IDENTITIES = Object.freeze({
  acknowledgeAssessment: "plant-intelligence.assessments.acknowledge",
  setAttestation: "plant-intelligence.attestations.set",
  saveCheckin: "plant-intelligence.checkins.save",
  transitionPhase: "plant-intelligence.declarations.transition",
  submitFeedback: "plant-intelligence.feedback.submit",
} as const);
