import type { SeatFields } from "../auth/tenancy";
import type { DiscoveryProfile } from "../../db/schema/discovery-profile";

export type { DiscoveryProfile } from "../../db/schema/discovery-profile";

export type DiscoveryConversionDecision =
  | { status: "not-discovery" }
  | {
      status: "refused";
      reason:
        | "account-mismatch"
        | "account-has-standing"
        | "leave-associations";
    }
  | { status: "eligible" };

/**
 * #294: a new plant inherits discovery associations; joining a seat requires
 * leaving them first. This decision grants nothing and performs no writes.
 *
 * The writer must read these values after locking the subject user and repeat
 * eligibility in its winning write predicate. Token scope, email identity and
 * expiry remain the invitation service's checks. Every dependent write must
 * select from the winner; an eligible result is not a durable authorization.
 */
export function discoveryConversionDecision(
  account: SeatFields & { id: string },
  profile: DiscoveryProfile | null,
  destination: "plant" | "seat"
): DiscoveryConversionDecision {
  if (!profile) return { status: "not-discovery" };
  if (profile.userId !== account.id) {
    return { status: "refused", reason: "account-mismatch" };
  }
  if (
    account.seat !== null ||
    account.churchId !== null ||
    account.sendingChurchId !== null ||
    account.sendingNetworkId !== null
  ) {
    return { status: "refused", reason: "account-has-standing" };
  }
  if (
    destination === "seat" &&
    (profile.sendingChurchId !== null || profile.sendingNetworkId !== null)
  ) {
    return { status: "refused", reason: "leave-associations" };
  }
  return { status: "eligible" };
}
