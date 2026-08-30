import { sql } from "drizzle-orm";

import { db } from "@/db";
import type {
  evryAuditEventTypes,
  evryExecutionOutcomeStatuses,
  evryExecutionOutcomeSubjects,
  evryExecutionResultCodes,
  evryRequestAuditResultCodes,
} from "@/db/schema";

import type { EvryCorrelationId } from "./identity";

export type EvryRedactedTelemetryRecord = Readonly<{
  correlationId: string;
  recordKind:
    | "audit_event"
    | "execution_attempt"
    | "effect_claim"
    | "execution_outcome";
  eventName:
    | (typeof evryAuditEventTypes)[number]
    | "attempt_started"
    | "domain_mutation_claimed"
    | (typeof evryExecutionOutcomeSubjects)[number];
  capabilityIdentity: string | null;
  status:
    | (typeof evryExecutionOutcomeStatuses)[number]
    | (typeof evryRequestAuditResultCodes)[number]
    | "reconciling"
    | null;
  resultCode:
    | (typeof evryExecutionResultCodes)[number]
    | (typeof evryRequestAuditResultCodes)[number]
    | null;
  affectedCount: number | null;
  excludedCount: number | null;
  occurredAt: string;
}>;

interface RedactedTelemetryRow extends Record<string, unknown> {
  correlation_id: string;
  record_kind: EvryRedactedTelemetryRecord["recordKind"];
  event_name: EvryRedactedTelemetryRecord["eventName"];
  capability_identity: string | null;
  status: EvryRedactedTelemetryRecord["status"];
  result_code: EvryRedactedTelemetryRecord["resultCode"];
  affected_count: number | null;
  excluded_count: number | null;
  occurred_at: string | Date;
}

/** The only #768-facing reader; its projection cannot select scoped identities. */
export async function readEvryRedactedTelemetry(
  correlationId: EvryCorrelationId
): Promise<readonly EvryRedactedTelemetryRecord[]> {
  const result = await db.execute<RedactedTelemetryRow>(sql`
    select
      correlation_id, record_kind, event_name, capability_identity,
      status, result_code, affected_count, excluded_count, occurred_at
    from evry_redacted_telemetry
    where correlation_id = ${correlationId}::uuid
    order by occurred_at, record_kind, event_name
  `);

  return result.rows.map((row) =>
    Object.freeze({
      correlationId: row.correlation_id,
      recordKind: row.record_kind,
      eventName: row.event_name,
      capabilityIdentity: row.capability_identity,
      status: row.status,
      resultCode: row.result_code,
      affectedCount: row.affected_count,
      excludedCount: row.excluded_count,
      occurredAt: new Date(row.occurred_at).toISOString(),
    })
  );
}
