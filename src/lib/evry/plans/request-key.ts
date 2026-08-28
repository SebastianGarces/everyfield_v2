import { randomUUID } from "node:crypto";

const EVRY_PLAN_REQUEST_KEY: unique symbol = Symbol("EvryPlanRequestKey");

/** Stable identity for one server-owned action-request continuation. */
export type EvryPlanRequestKey = string & {
  readonly [EVRY_PLAN_REQUEST_KEY]: true;
};

/** Mint once at the authenticated request boundary; reuse only for its retry. */
export function mintEvryPlanRequestKey(): EvryPlanRequestKey {
  return randomUUID() as EvryPlanRequestKey;
}
