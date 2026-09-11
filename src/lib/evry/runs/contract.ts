import { createHash } from "node:crypto";

import { z } from "zod";

import {
  evryActiveRunKinds,
  evryActiveRunOperations,
  evryActiveRunStages,
  evryActiveRunStatuses,
  type EvryActiveRunKind,
  type EvryActiveRunOperation,
  type EvryActiveRunStage,
  type EvryActiveRunStatus,
} from "@/db/schema";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

export const EVRY_ACTIVE_RUN_TTL_MS = 15 * 60 * 1_000;

const uuidSchema = z.string().uuid();
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);

export type EvryActiveRunIdentity =
  | Readonly<{
      kind: "conversation";
      operation: "create" | "reuse";
      conversationId: null;
      planId: null;
      planFingerprint: null;
    }>
  | Readonly<{
      kind: "conversation";
      operation: "continue";
      conversationId: string;
      planId: null;
      planFingerprint: null;
    }>
  | Readonly<{
      kind: "execution";
      operation: "execute" | "retry";
      conversationId: string;
      planId: string;
      planFingerprint: string;
    }>;

export type EvryActiveRunRecord = Readonly<{
  id: string;
  actorUserId: string;
  plantId: string;
  requestKey: string;
  requestFingerprint: string;
  kind: EvryActiveRunKind;
  operation: EvryActiveRunOperation;
  status: EvryActiveRunStatus;
  stage: EvryActiveRunStage;
  version: number;
  conversationId: string | null;
  planId: string | null;
  planFingerprint: string | null;
  startedAt: Date;
  changedAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
}>;

export type EvryActiveRunClaim = Readonly<{
  ownership: "claimed" | "adopted";
  run: EvryActiveRunRecord;
}>;

export class EvryActiveRunIdentityError extends Error {
  constructor() {
    super("Evry active run identity did not match its durable claim");
    this.name = "EvryActiveRunIdentityError";
  }
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  throw new Error("Evry active run identity must be canonical JSON");
}

export function fingerprintEvryActiveRunRequest(input: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(input), "utf8")
    .digest("hex");
}

export function parseEvryActiveRunRecord(input: {
  id: string;
  churchId: string;
  actorUserId: string;
  requestKey: string;
  requestFingerprint: string;
  kind: string;
  operation: string;
  status: string;
  stage: string;
  version: number;
  conversationId: string | null;
  planId: string | null;
  planFingerprint: string | null;
  startedAt: Date;
  changedAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
}): EvryActiveRunRecord {
  const parsed = z
    .object({
      id: uuidSchema,
      churchId: uuidSchema,
      actorUserId: uuidSchema,
      requestKey: uuidSchema,
      requestFingerprint: fingerprintSchema,
      kind: z.enum(evryActiveRunKinds),
      operation: z.enum(evryActiveRunOperations),
      status: z.enum(evryActiveRunStatuses),
      stage: z.enum(evryActiveRunStages),
      version: z.number().int().nonnegative(),
      conversationId: uuidSchema.nullable(),
      planId: uuidSchema.nullable(),
      planFingerprint: fingerprintSchema.nullable(),
      startedAt: z.date(),
      changedAt: z.date(),
      expiresAt: z.date(),
      completedAt: z.date().nullable(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) throw new EvryActiveRunIdentityError();
  const row = parsed.data;
  const terminalShape =
    row.status === "active"
      ? row.completedAt === null
      : row.completedAt !== null &&
        (row.status !== "completed" || row.conversationId !== null);
  const conversationShape =
    row.kind === "conversation" &&
    (row.operation === "create" ||
      row.operation === "continue" ||
      row.operation === "reuse") &&
    row.planId === null &&
    row.planFingerprint === null &&
    row.stage !== "executing" &&
    (row.operation === "continue" ||
      row.status !== "active" ||
      row.conversationId === null) &&
    (row.operation === "create" ||
      row.operation === "reuse" ||
      row.conversationId !== null);
  const executionShape =
    row.kind === "execution" &&
    (row.operation === "execute" || row.operation === "retry") &&
    row.conversationId !== null &&
    row.planId !== null &&
    row.planFingerprint !== null &&
    row.stage === "executing";
  const expiryShape =
    (row.kind === "conversation" &&
      row.expiresAt.valueOf() ===
        row.startedAt.valueOf() + EVRY_ACTIVE_RUN_TTL_MS) ||
    (row.kind === "execution" &&
      row.expiresAt >= row.startedAt &&
      (row.status !== "active" || row.expiresAt >= row.changedAt));
  if (
    !terminalShape ||
    (!conversationShape && !executionShape) ||
    row.changedAt < row.startedAt ||
    !expiryShape
  ) {
    throw new EvryActiveRunIdentityError();
  }
  return Object.freeze({
    id: row.id,
    plantId: row.churchId,
    actorUserId: row.actorUserId,
    requestKey: row.requestKey,
    requestFingerprint: row.requestFingerprint,
    kind: row.kind,
    operation: row.operation,
    status: row.status,
    stage: row.stage,
    version: row.version,
    conversationId: row.conversationId,
    planId: row.planId,
    planFingerprint: row.planFingerprint,
    startedAt: row.startedAt,
    changedAt: row.changedAt,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
  });
}

export function sameEvryActiveRunIdentity(
  row: EvryActiveRunRecord,
  identity: EvryActiveRunIdentity,
  requestFingerprint: string
): boolean {
  const sameConversation =
    row.conversationId === identity.conversationId ||
    ((row.operation === "create" || row.operation === "reuse") &&
      identity.conversationId === null);
  return (
    row.requestFingerprint === requestFingerprint &&
    row.kind === identity.kind &&
    row.operation === identity.operation &&
    sameConversation &&
    row.planId === identity.planId &&
    row.planFingerprint === identity.planFingerprint
  );
}

export type EvryActiveRunStoreInput = Readonly<{
  actor: EvryPlantActor;
  requestKey: string;
}>;
