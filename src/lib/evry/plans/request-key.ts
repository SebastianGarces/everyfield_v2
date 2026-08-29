import { createHash, randomUUID } from "node:crypto";

const EVRY_PLAN_REQUEST_KEY: unique symbol = Symbol("EvryPlanRequestKey");

/** Stable identity for one server-owned action-request continuation. */
export type EvryPlanRequestKey = string & {
  readonly [EVRY_PLAN_REQUEST_KEY]: true;
};

/** Mint once at the authenticated request boundary; reuse only for its retry. */
export function mintEvryPlanRequestKey(): EvryPlanRequestKey {
  return randomUUID() as EvryPlanRequestKey;
}

/** Derive the stable plan continuation key for one durable application turn. */
export function deriveEvryPlanRequestKey(
  namespace: string,
  parts: readonly [string, ...string[]]
): EvryPlanRequestKey {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(namespace)) {
    throw new Error("Invalid Evry plan request-key namespace");
  }
  const hash = createHash("sha256");
  for (const value of ["evry-plan-request-v1", namespace, ...parts]) {
    const bytes = Buffer.from(value, "utf8");
    hash.update(String(bytes.length));
    hash.update(":");
    hash.update(bytes);
  }
  const bytes = hash.digest("hex").slice(0, 32).split("");
  bytes[12] = "4";
  bytes[16] = ((Number.parseInt(bytes[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16
  );
  return `${bytes.slice(0, 8).join("")}-${bytes
    .slice(8, 12)
    .join("")}-${bytes.slice(12, 16).join("")}-${bytes
    .slice(16, 20)
    .join("")}-${bytes.slice(20).join("")}` as EvryPlanRequestKey;
}
