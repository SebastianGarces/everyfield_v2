import { z } from "zod";

import type { EvryTraceDocument } from "./contract";

export const EVRY_LATENCY_SEGMENTS = [
  "model",
  "application_read",
  "external_service",
  "execution",
  "render",
] as const;
export type EvryLatencySegment = (typeof EVRY_LATENCY_SEGMENTS)[number];

export const EVRY_LATENCY_MILESTONES = [
  "acknowledgement",
  "useful_output",
  "confirmation_artifact",
] as const;

export const EVRY_LATENCY_BUDGET_MS = Object.freeze({
  acknowledgement: 250,
  useful_output: 2_000,
  confirmation_artifact: 8_000,
} as const);

const safeIdentitySchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:/-]*$/i);
const observationBase = {
  requestId: z.string().uuid(),
  environment: safeIdentitySchema,
  source: z.enum(["server_trace", "client_performance", "controlled_fixture"]),
  capabilityIdentity: safeIdentitySchema.nullable(),
  recipeIdentity: safeIdentitySchema.nullable(),
  durationMs: z.number().nonnegative().finite(),
};

export const evryLatencyObservationSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("segment"),
        ...observationBase,
        segment: z.enum(EVRY_LATENCY_SEGMENTS),
      })
      .strict()
      .readonly(),
    z
      .object({
        kind: z.literal("milestone"),
        ...observationBase,
        milestone: z.enum(EVRY_LATENCY_MILESTONES),
      })
      .strict()
      .readonly(),
  ])
  .superRefine((observation, context) => {
    if (
      observation.source === "client_performance" &&
      (observation.capabilityIdentity !== null ||
        observation.recipeIdentity !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message:
          "Client performance observations cannot claim trusted capability or recipe identity",
      });
    }
  });

export type EvryLatencyObservation = z.infer<
  typeof evryLatencyObservationSchema
>;

export function parseEvryLatencyObservation(
  input: unknown
): EvryLatencyObservation {
  return evryLatencyObservationSchema.parse(input);
}

/** Project trusted, content-free server trace spans into request latency segments. */
export function evryLatencyObservationsFromTrace(
  trace: EvryTraceDocument
): readonly EvryLatencyObservation[] {
  return trace.spans.flatMap((span) => {
    if (span.details.kind === "generation") {
      const grouping = span.details.grouping;
      if (grouping.kind === "request-policy") return [];
      return [
        parseEvryLatencyObservation({
          kind: "segment",
          requestId: trace.correlationId,
          environment: trace.environment,
          source: "server_trace",
          capabilityIdentity:
            grouping.kind === "selected-capability"
              ? grouping.capabilityIdentity
              : null,
          recipeIdentity:
            grouping.kind === "selected-recipe"
              ? grouping.recipeIdentity
              : trace.recipeIdentity,
          segment: "model",
          durationMs: span.durationMs,
        }),
      ];
    }
    if (!span.details.latencySegment) return [];
    if (span.capabilityIdentity === null && trace.recipeIdentity === null) {
      return [];
    }
    return [
      parseEvryLatencyObservation({
        kind: "segment",
        requestId: trace.correlationId,
        environment: trace.environment,
        source: "server_trace",
        capabilityIdentity: span.capabilityIdentity,
        recipeIdentity: trace.recipeIdentity,
        segment: span.details.latencySegment,
        durationMs: span.durationMs,
      }),
    ];
  });
}

type Percentiles = Readonly<{
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
}>;

type BudgetPercentiles = Percentiles &
  Readonly<{ budgetMs: number; withinBudget: boolean }>;

export type EvryLatencyReportRow = Readonly<{
  environment: string;
  source: EvryLatencyObservation["source"];
  identity: string;
  segments: Readonly<Record<EvryLatencySegment, Percentiles>>;
  milestones: Readonly<
    Record<(typeof EVRY_LATENCY_MILESTONES)[number], BudgetPercentiles>
  >;
}>;

export type EvryLatencyReport = Readonly<{
  schemaVersion: 2;
  observations: number;
  capabilities: readonly EvryLatencyReportRow[];
  recipes: readonly EvryLatencyReportRow[];
  unattributedRequests: readonly EvryLatencyReportRow[];
}>;

function percentile(
  values: readonly number[],
  proportion: number
): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(proportion * sorted.length) - 1)] ?? null;
}

function distribution(values: readonly number[]): Percentiles {
  return Object.freeze({
    samples: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  });
}

function reportRow(
  environment: string,
  source: EvryLatencyObservation["source"],
  identity: string,
  observations: readonly EvryLatencyObservation[]
): EvryLatencyReportRow {
  const segmentDistribution = (segment: EvryLatencySegment) =>
    distribution(
      [...groupByRequest(observations)].flatMap(([, requestObservations]) => {
        const durations = requestObservations.flatMap((observation) =>
          observation.kind === "segment" && observation.segment === segment
            ? [observation.durationMs]
            : []
        );
        return durations.length
          ? [durations.reduce((total, duration) => total + duration, 0)]
          : [];
      })
    );
  const milestoneDistribution = (
    milestone: (typeof EVRY_LATENCY_MILESTONES)[number]
  ): BudgetPercentiles => {
    const valuesReport = distribution(
      observations.flatMap((observation) =>
        observation.kind === "milestone" && observation.milestone === milestone
          ? [observation.durationMs]
          : []
      )
    );
    const budgetMs = EVRY_LATENCY_BUDGET_MS[milestone];
    return Object.freeze({
      ...valuesReport,
      budgetMs,
      withinBudget:
        valuesReport.p95Ms !== null && valuesReport.p95Ms <= budgetMs,
    });
  };
  const segments = Object.freeze({
    model: segmentDistribution("model"),
    application_read: segmentDistribution("application_read"),
    external_service: segmentDistribution("external_service"),
    execution: segmentDistribution("execution"),
    render: segmentDistribution("render"),
  });
  const milestones = Object.freeze({
    acknowledgement: milestoneDistribution("acknowledgement"),
    useful_output: milestoneDistribution("useful_output"),
    confirmation_artifact: milestoneDistribution("confirmation_artifact"),
  });
  return Object.freeze({ environment, source, identity, segments, milestones });
}

function groupByRequest(
  observations: readonly EvryLatencyObservation[]
): Map<string, EvryLatencyObservation[]> {
  const requests = new Map<string, EvryLatencyObservation[]>();
  for (const observation of observations) {
    const request = requests.get(observation.requestId) ?? [];
    request.push(observation);
    requests.set(observation.requestId, request);
  }
  return requests;
}

function groupByRequestAndSource(
  observations: readonly EvryLatencyObservation[]
): Map<string, EvryLatencyObservation[]> {
  const requests = new Map<string, EvryLatencyObservation[]>();
  for (const observation of observations) {
    const key = `${observation.requestId}\0${observation.source}`;
    const request = requests.get(key) ?? [];
    request.push(observation);
    requests.set(key, request);
  }
  return requests;
}

type TrustedRequestAttribution = Readonly<{
  capabilityIdentity: string | null;
  recipeIdentity: string | null;
}>;

function requestEnvironmentKey(requestId: string, environment: string): string {
  return `${requestId}\0${environment}`;
}

function trustedRequestAttribution(
  observations: readonly EvryLatencyObservation[]
): ReadonlyMap<string, TrustedRequestAttribution> {
  const trustedByRequest = new Map<string, EvryLatencyObservation[]>();
  for (const observation of observations) {
    if (observation.source !== "server_trace") continue;
    const key = requestEnvironmentKey(
      observation.requestId,
      observation.environment
    );
    const trusted = trustedByRequest.get(key) ?? [];
    trusted.push(observation);
    trustedByRequest.set(key, trusted);
  }

  return new Map(
    [...trustedByRequest].map(([key, trusted]) => {
      const capabilities = new Set(
        trusted.flatMap(({ capabilityIdentity }) =>
          capabilityIdentity === null ? [] : [capabilityIdentity]
        )
      );
      const recipes = new Set(
        trusted.flatMap(({ recipeIdentity }) =>
          recipeIdentity === null ? [] : [recipeIdentity]
        )
      );
      const [onlyCapability] = capabilities;
      const [onlyRecipe] = recipes;
      return [
        key,
        Object.freeze({
          capabilityIdentity:
            capabilities.size === 1 ? (onlyCapability ?? null) : null,
          recipeIdentity: recipes.size === 1 ? (onlyRecipe ?? null) : null,
        }),
      ];
    })
  );
}

function assertRequestIntegrity(
  observations: readonly EvryLatencyObservation[]
): void {
  for (const requestObservations of groupByRequestAndSource(
    observations
  ).values()) {
    const [first] = requestObservations;
    if (!first) continue;
    if (
      requestObservations.some(
        (observation) =>
          observation.environment !== first.environment ||
          observation.source !== first.source ||
          observation.recipeIdentity !== first.recipeIdentity
      )
    ) {
      throw new Error(
        `Evry latency request ${first.requestId} source ${first.source} changed identity`
      );
    }
    for (const milestone of EVRY_LATENCY_MILESTONES) {
      if (
        requestObservations.filter(
          (observation) =>
            observation.kind === "milestone" &&
            observation.milestone === milestone
        ).length > 1
      ) {
        throw new Error(
          `Evry latency request ${first.requestId} source ${first.source} duplicated ${milestone}`
        );
      }
    }
  }
}

function groupedRows(
  observations: readonly EvryLatencyObservation[],
  identityFor: (observation: EvryLatencyObservation) => string | null
): readonly EvryLatencyReportRow[] {
  const groups = new Map<
    string,
    Readonly<{
      environment: string;
      source: EvryLatencyObservation["source"];
      identity: string;
      observations: EvryLatencyObservation[];
    }>
  >();
  for (const observation of observations) {
    const identity = identityFor(observation);
    if (identity === null) continue;
    const key = `${observation.environment}\0${observation.source}\0${identity}`;
    const group = groups.get(key) ?? {
      environment: observation.environment,
      source: observation.source,
      identity,
      observations: [],
    };
    group.observations.push(observation);
    groups.set(key, group);
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) =>
      reportRow(
        group.environment,
        group.source,
        group.identity,
        group.observations
      )
    );
}

function durationLabel(value: number | null): string {
  return value === null ? "n/a" : `${value} ms`;
}

export function renderEvryLatencyReportMarkdown(
  report: EvryLatencyReport
): string {
  const rows = [
    ...report.capabilities.map((row) => ({ ...row, scope: "Capability" })),
    ...report.recipes.map((row) => ({ ...row, scope: "Recipe" })),
    ...report.unattributedRequests.map((row) => ({
      ...row,
      scope: "Unattributed request",
    })),
  ];
  const body = rows
    .map(
      (row) =>
        `| ${row.environment} | ${row.source} | ${row.scope} | ${row.identity} | ${durationLabel(row.milestones.acknowledgement.p50Ms)} / ${durationLabel(row.milestones.acknowledgement.p95Ms)} | ${durationLabel(row.milestones.useful_output.p50Ms)} / ${durationLabel(row.milestones.useful_output.p95Ms)} | ${durationLabel(row.milestones.confirmation_artifact.p50Ms)} / ${durationLabel(row.milestones.confirmation_artifact.p95Ms)} | ${EVRY_LATENCY_SEGMENTS.map((segment) => `${segment}: ${durationLabel(row.segments[segment].p50Ms)} / ${durationLabel(row.segments[segment].p95Ms)}`).join("<br>")} |`
    )
    .join("\n");
  return `# Evry latency report\n\nRows keep controlled, client-performance, and server-trace sources separate. Client-performance rows receive capability or recipe attribution only from the same request's trusted server trace. Unattributed requests remain visible but are excluded from capability and recipe results. All durations are nearest-rank p50 / p95. "n/a" means that scope did not perform that milestone or segment.\n\n| Environment | Source | Scope | Identity | Acknowledgement | Useful output | Confirmation artifact | Segments |\n|---|---|---|---|---:|---:|---:|---|\n${body}\n`;
}

export function buildEvryLatencyReport(
  unsafeObservations: readonly unknown[]
): EvryLatencyReport {
  const observations = unsafeObservations.map(parseEvryLatencyObservation);
  assertRequestIntegrity(observations);
  const trustedAttribution = trustedRequestAttribution(observations);
  const reportingIdentity = (
    observation: EvryLatencyObservation,
    dimension: keyof TrustedRequestAttribution
  ): string | null =>
    observation.source === "client_performance"
      ? (trustedAttribution.get(
          requestEnvironmentKey(observation.requestId, observation.environment)
        )?.[dimension] ?? null)
      : observation[dimension];
  return Object.freeze({
    schemaVersion: 2,
    observations: observations.length,
    capabilities: groupedRows(observations, (observation) =>
      reportingIdentity(observation, "capabilityIdentity")
    ),
    recipes: groupedRows(observations, (observation) =>
      reportingIdentity(observation, "recipeIdentity")
    ),
    unattributedRequests: groupedRows(observations, (observation) => {
      if (observation.source !== "client_performance") return null;
      const attribution = trustedAttribution.get(
        requestEnvironmentKey(observation.requestId, observation.environment)
      );
      if (!attribution) return "unattributed";
      return attribution.capabilityIdentity === null &&
        attribution.recipeIdentity === null
        ? "unattributed"
        : null;
    }),
  });
}
