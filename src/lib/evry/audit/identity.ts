import { createHash, randomUUID } from "node:crypto";

import type { EvryPlanRequestKey } from "@/lib/evry/plans/request-key";

const EVRY_CORRELATION_ID: unique symbol = Symbol("EvryCorrelationId");
const EVRY_AUDIT_KEY: unique symbol = Symbol("EvryAuditKey");
const EVRY_AUDIT_REQUEST: unique symbol = Symbol("EvryAuditRequest");

/** One server-minted root shared by request audit and its paired plan key. */
export type EvryCorrelationId = string & {
  readonly [EVRY_CORRELATION_ID]: true;
};

/** Deterministic SHA-256 identity for one closed audit fact. */
export type EvryAuditKey = string & { readonly [EVRY_AUDIT_KEY]: true };

export type EvryAuditRequest = Readonly<{
  correlationId: EvryCorrelationId;
  eventKey: EvryAuditKey;
  planRequestKey: EvryPlanRequestKey;
  [EVRY_AUDIT_REQUEST]: true;
}>;

export function correlationForPlanRequest(
  requestKey: EvryPlanRequestKey
): EvryCorrelationId {
  return String(requestKey) as EvryCorrelationId;
}

function auditKey(parts: readonly string[]): EvryAuditKey {
  return createHash("sha256")
    .update(["evry-audit-v1", ...parts].join("\u001f"))
    .digest("hex") as EvryAuditKey;
}

/** Mint once after authentication; request data and models cannot construct it. */
export function mintEvryAuditRequest(): EvryAuditRequest {
  const correlationId = randomUUID() as EvryCorrelationId;
  return Object.freeze({
    correlationId,
    eventKey: auditKey(["request-result", correlationId]),
    planRequestKey: String(correlationId) as EvryPlanRequestKey,
    [EVRY_AUDIT_REQUEST]: true as const,
  });
}

export function planEventKey(
  planId: string,
  eventType:
    | "plan_proposed"
    | "plan_approved"
    | "plan_cancelled"
    | "plan_expired"
    | "plan_superseded"
): EvryAuditKey {
  return auditKey(["plan-event", planId, eventType]);
}

export function noopAttemptKey(planId: string): EvryAuditKey {
  return auditKey(["noop-attempt", planId]);
}

export function noopOutcomeKey(planId: string): EvryAuditKey {
  return auditKey(["noop-outcome", planId]);
}

export function noopEffectKey(planId: string): EvryAuditKey {
  return auditKey(["noop-effect", planId]);
}
