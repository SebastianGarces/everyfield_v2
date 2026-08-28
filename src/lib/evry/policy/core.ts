import {
  boundaryArtifactFor,
  settingsHandoffArtifactFor,
  type EvryBoundaryArtifact,
  type EvrySettingsHandoffArtifact,
} from "./artifacts";
import type {
  EvryPolicyClassification,
  EvryPolicyModelDecision,
} from "./schema";

export type EvryAllowedPolicyDecision =
  | Readonly<{
      classification: "application_read";
      continuation: Readonly<{
        kind: "application_read";
        literalUserText: string;
      }>;
    }>
  | Readonly<{
      classification: "application_action";
      continuation: Readonly<{
        kind: "application_action";
        literalUserText: string;
      }>;
    }>;

export type EvryStoppedPolicyDecision =
  | Readonly<{
      classification: "settings";
      artifact: EvrySettingsHandoffArtifact;
    }>
  | Readonly<{
      classification: Exclude<
        EvryPolicyClassification,
        "application_read" | "application_action" | "settings"
      >;
      artifact: EvryBoundaryArtifact;
    }>;

/**
 * Capability eligibility is structural: only an allowed decision has a
 * continuation, and only that continuation carries the literal request bytes.
 */
export type EvryPolicyDecision =
  | EvryAllowedPolicyDecision
  | EvryStoppedPolicyDecision;

export function resolveEvryPolicyDecision(
  literalUserText: string,
  modelDecision: EvryPolicyModelDecision
): EvryPolicyDecision {
  switch (modelDecision.classification) {
    case "application_read":
      return {
        classification: "application_read",
        continuation: {
          kind: "application_read",
          literalUserText,
        },
      };
    case "application_action":
      return {
        classification: "application_action",
        continuation: {
          kind: "application_action",
          literalUserText,
        },
      };
    case "settings": {
      const artifact = settingsHandoffArtifactFor(
        modelDecision.settingsSectionId
      );
      // Both values come from the same generated catalog. If they ever drift,
      // stop at the policy boundary instead of manufacturing a destination.
      return artifact
        ? { classification: "settings", artifact }
        : failClosedEvryPolicyDecision();
    }
    case "theology_or_spiritual_guidance":
    case "unrelated":
    case "mixed":
    case "ambiguous":
      return {
        classification: modelDecision.classification,
        artifact: boundaryArtifactFor(modelDecision.classification),
      };
  }
}

/** Provider, transport, and schema failures share the ordinary ambiguity copy. */
export function failClosedEvryPolicyDecision(): EvryStoppedPolicyDecision {
  return {
    classification: "ambiguous",
    artifact: boundaryArtifactFor("ambiguous"),
  };
}
