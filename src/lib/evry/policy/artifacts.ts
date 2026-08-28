import { EVRY_SETTINGS_CATALOG } from "./inventory";
import type { EvryPolicyClassification, EvrySettingsSectionId } from "./schema";

export type EvryBoundaryClassification = Exclude<
  EvryPolicyClassification,
  "application_read" | "application_action" | "settings"
>;

export type EvryBoundaryArtifact = Readonly<{
  kind: "boundary";
  title: string;
  message: string;
  examples: readonly string[];
}>;

export type EvrySettingsHandoffArtifact = Readonly<{
  kind: "settings_handoff";
  title: string;
  message: string;
  destination: Readonly<{
    /** Serialized boundary data; the UI validates this against its registry. */
    sectionId: string;
  }>;
}>;

export type EvryPublicPolicyArtifact =
  | EvryBoundaryArtifact
  | EvrySettingsHandoffArtifact;

const EXAMPLES = ["Find overdue tasks", "Create a meeting"] as const;

const APPLICATION_ONLY_BOUNDARY: EvryBoundaryArtifact = {
  kind: "boundary",
  title: "Ask Evry about EveryField",
  message:
    "Evry can help with work in EveryField, such as tasks, people, meetings, documents, or plant progress.",
  examples: EXAMPLES,
};

const MIXED_BOUNDARY: EvryBoundaryArtifact = {
  kind: "boundary",
  title: "Ask Evry about EveryField",
  message:
    "Send the EveryField work as a separate request. Nothing from this request was run.",
  examples: EXAMPLES,
};

const AMBIGUOUS_BOUNDARY: EvryBoundaryArtifact = {
  kind: "boundary",
  title: "Ask Evry about EveryField",
  message:
    "Name the EveryField work you want Evry to do. Nothing from this request was run.",
  examples: EXAMPLES,
};

/** Fixed public copy. The internal class never becomes model-written prose. */
export function boundaryArtifactFor(
  classification: EvryBoundaryClassification
): EvryBoundaryArtifact {
  switch (classification) {
    case "theology_or_spiritual_guidance":
    case "unrelated":
      return APPLICATION_ONLY_BOUNDARY;
    case "mixed":
      return MIXED_BOUNDARY;
    case "ambiguous":
      return AMBIGUOUS_BOUNDARY;
  }
}

/**
 * Build a static destination from the same generated entry the model schema
 * accepted. No Settings loader, visibility predicate, or current value runs.
 */
export function settingsHandoffArtifactFor(
  sectionId: EvrySettingsSectionId
): EvrySettingsHandoffArtifact | null {
  const section = EVRY_SETTINGS_CATALOG.find(({ id }) => id === sectionId);
  if (!section) return null;

  return {
    kind: "settings_handoff",
    title: `Open ${section.label} settings`,
    message:
      "Review or change this in EveryField Settings. Evry has not read or changed the setting.",
    destination: {
      sectionId: section.id,
    },
  };
}
