import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import {
  storedEvryReadArtifactDocument,
  type StoredEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";

type CommunicationEvryExclusion = Readonly<{
  reason: string;
  count: number;
}>;

export type CommunicationEvryRefusal = Readonly<{
  kind: "refusal";
  body: string;
  artifact: StoredEvryConversationArtifactDocument;
}>;

const NO_MATCH: CommunicationEvryExclusion = Object.freeze({
  reason: "No eligible recipients matched this selection",
  count: 1,
});

export const COMMUNICATION_UNAVAILABLE_EXCLUSION: CommunicationEvryExclusion =
  Object.freeze({
    reason: "Unavailable in this plant or no longer active",
    count: 1,
  });

/** A matched closed request always gets one durable, neutral result. */
export function communicationEvryRefusal(input: {
  title: string;
  body: string;
  exclusions?: readonly CommunicationEvryExclusion[];
}): CommunicationEvryRefusal {
  const exclusions =
    input.exclusions && input.exclusions.length > 0
      ? input.exclusions
      : [NO_MATCH];
  return Object.freeze({
    kind: "refusal",
    body: input.body,
    artifact: storedEvryReadArtifactDocument(
      buildEvryReadArtifact({
        title: input.title,
        filters: [{ label: "Plant", value: "Current plant" }],
        exclusions,
        items: [],
        sourceLinks: [
          trustedEvryApplicationSourceLink({
            label: "Open Communication Hub",
            href: "/communication",
          }),
        ],
      })
    ),
  });
}

export function communicationEvryUnavailable(
  subject: string
): CommunicationEvryRefusal {
  return communicationEvryRefusal({
    title: `${subject} unavailable`,
    body: `Evry could not prepare this Communication change because the ${subject.toLowerCase()} is unavailable in this plant.`,
    exclusions: [COMMUNICATION_UNAVAILABLE_EXCLUSION],
  });
}
