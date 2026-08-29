import {
  EVRY_LATENCY_SEGMENTS,
  type EvryLatencyObservation,
  type EvryLatencySegment,
} from "./latency";

const PEOPLE_REQUESTS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
] as const;
const RECIPE_REQUESTS = [
  "10000000-0000-4000-8000-000000000005",
  "10000000-0000-4000-8000-000000000006",
  "10000000-0000-4000-8000-000000000007",
  "10000000-0000-4000-8000-000000000008",
] as const;

function observationsFor(input: {
  requestIds: readonly string[];
  capabilityIdentity: string;
  recipeIdentity: string | null;
  acknowledgement: readonly number[];
  usefulOutput: readonly number[];
  confirmationArtifact?: readonly number[];
  segments: Readonly<Partial<Record<EvryLatencySegment, readonly number[]>>>;
}): EvryLatencyObservation[] {
  const observations: EvryLatencyObservation[] = [];
  const durationAt = (values: readonly number[], index: number) => {
    const duration = values[index];
    if (duration === undefined) {
      throw new Error("Controlled latency fixture dimensions must match");
    }
    return duration;
  };
  input.requestIds.forEach((requestId, index) => {
    observations.push(
      {
        kind: "milestone",
        requestId,
        environment: "controlled-fixture",
        source: "controlled_fixture",
        capabilityIdentity: input.capabilityIdentity,
        recipeIdentity: input.recipeIdentity,
        milestone: "acknowledgement",
        durationMs: durationAt(input.acknowledgement, index),
      },
      {
        kind: "milestone",
        requestId,
        environment: "controlled-fixture",
        source: "controlled_fixture",
        capabilityIdentity: input.capabilityIdentity,
        recipeIdentity: input.recipeIdentity,
        milestone: "useful_output",
        durationMs: durationAt(input.usefulOutput, index),
      }
    );
    if (input.confirmationArtifact) {
      observations.push({
        kind: "milestone",
        requestId,
        environment: "controlled-fixture",
        source: "controlled_fixture",
        capabilityIdentity: input.capabilityIdentity,
        recipeIdentity: input.recipeIdentity,
        milestone: "confirmation_artifact",
        durationMs: durationAt(input.confirmationArtifact, index),
      });
    }
    for (const segment of EVRY_LATENCY_SEGMENTS) {
      const values = input.segments[segment];
      if (!values) continue;
      observations.push({
        kind: "segment",
        requestId,
        environment: "controlled-fixture",
        source: "controlled_fixture",
        capabilityIdentity: input.capabilityIdentity,
        recipeIdentity: input.recipeIdentity,
        segment,
        durationMs: durationAt(values, index),
      });
    }
  });
  return observations;
}

export const CONTROLLED_EVRY_LATENCY_FIXTURE: readonly EvryLatencyObservation[] =
  Object.freeze([
    ...observationsFor({
      requestIds: PEOPLE_REQUESTS,
      capabilityIdentity: "people.read",
      recipeIdentity: null,
      acknowledgement: [60, 80, 90, 110],
      usefulOutput: [700, 900, 1_100, 1_500],
      segments: {
        model: [420, 500, 600, 750],
        application_read: [100, 120, 140, 180],
        render: [12, 14, 16, 20],
      },
    }),
    ...observationsFor({
      requestIds: RECIPE_REQUESTS,
      capabilityIdentity: "meeting.create",
      recipeIdentity: "meeting.invitation",
      acknowledgement: [70, 90, 110, 130],
      usefulOutput: [800, 1_000, 1_300, 1_700],
      confirmationArtifact: [4_000, 4_800, 6_000, 7_200],
      segments: {
        model: [1_600, 1_800, 2_000, 2_200],
        application_read: [500, 600, 700, 800],
        external_service: [250, 310, 340, 380],
        execution: [700, 800, 900, 1_100],
        render: [18, 22, 25, 30],
      },
    }),
  ]);
