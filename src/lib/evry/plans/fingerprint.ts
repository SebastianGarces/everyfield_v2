import { createHash } from "node:crypto";

import type { EvryActionPlanDocument, EvryJsonValue } from "./schema";

function canonicalize(value: EvryJsonValue): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Value is not canonical JSON");
    return encoded;
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const objectValue = value as Readonly<Record<string, EvryJsonValue>>;
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(objectValue[key])}`)
    .join(",")}}`;
}

export function canonicalEvryPlanJson(input: {
  actorUserId: string;
  plantId: string;
  expiresAt: Date;
  document: EvryActionPlanDocument;
}): string {
  return canonicalize({
    actorUserId: input.actorUserId,
    document: input.document as unknown as EvryJsonValue,
    expiresAt: input.expiresAt.toISOString(),
    plantId: input.plantId,
    version: input.document.version,
  });
}

/** Stable logical-request identity, excluding its server-owned clock. */
export function fingerprintEvryActionPlanIntent(input: {
  actorUserId: string;
  plantId: string;
  document: EvryActionPlanDocument;
}): string {
  const canonical = canonicalize({
    actorUserId: input.actorUserId,
    document: input.document as unknown as EvryJsonValue,
    plantId: input.plantId,
    version: input.document.version,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function fingerprintEvryActionPlan(input: {
  actorUserId: string;
  plantId: string;
  expiresAt: Date;
  document: EvryActionPlanDocument;
}): string {
  return createHash("sha256")
    .update(canonicalEvryPlanJson(input))
    .digest("hex");
}
