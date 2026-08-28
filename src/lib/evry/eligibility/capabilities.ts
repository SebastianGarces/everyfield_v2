import inventory from "@/lib/evry/capabilities/inventory.generated.json";
import {
  ALL_CAPABILITIES,
  holdsSeatFor,
  type Capability,
} from "@/lib/auth/seat-rules";
import { tenancyColumns, type SeatFields } from "@/lib/auth/tenancy";

import { requireEvryPlantViewer, type EvryPlantActor } from "./viewer";

const EVRY_CAPABILITY_AUTHORIZATION: unique symbol = Symbol(
  "EvryCapabilityAuthorization"
);

const APPLICATION_CAPABILITIES = new Set<string>(ALL_CAPABILITIES);

function isApplicationCapability(value: string): value is Capability {
  return APPLICATION_CAPABILITIES.has(value);
}

/**
 * A trusted capability registration's authorization facts.
 *
 * Registrations own the mapping from their Evry identity to the application's
 * authoritative capability. Model output and persisted plans may select an
 * identity, but may not supply or replace this mapping.
 */
export type EvryCapabilityRegistration = Readonly<{
  identity: string;
  parityCapability: string;
  applicationCapability: Capability;
}>;

/** A fresh session-backed authorization for one trusted registration. */
export type EvryCapabilityAuthorization = Readonly<{
  actor: EvryPlantActor;
  registration: EvryCapabilityRegistration;
  [EVRY_CAPABILITY_AUTHORIZATION]: true;
}>;

function buildRegistry(): ReadonlyMap<string, EvryCapabilityRegistration> {
  const registrations = new Map<string, EvryCapabilityRegistration>();

  for (const entry of inventory.entries) {
    if (
      entry.kind !== "action" ||
      entry.classification.state !== "supported" ||
      typeof entry.applicationCapability !== "string" ||
      !isApplicationCapability(entry.applicationCapability)
    ) {
      continue;
    }

    if (registrations.has(entry.identity)) {
      throw new Error(`Duplicate Evry capability identity: ${entry.identity}`);
    }

    registrations.set(
      entry.identity,
      Object.freeze({
        identity: entry.identity,
        parityCapability: entry.parityCapability,
        applicationCapability: entry.applicationCapability,
      })
    );
  }

  return registrations;
}

const REGISTRY = buildRegistry();

export const EVRY_PEOPLE_READ_PROBE_IDENTITY =
  "action:src/app/(dashboard)/people/actions.ts → loadMorePeopleAction";

export const EVRY_PEOPLE_WRITE_PROBE_IDENTITY =
  "action:src/app/(dashboard)/people/actions.ts → updatePersonAction";

function seatFieldsOf(actor: EvryPlantActor): SeatFields {
  return {
    ...tenancyColumns({ type: "church", id: actor.plantId }),
    seat: actor.seat,
  };
}

/** Ask the application's one capability table whether this fresh actor may act. */
function actorHolds(
  actor: EvryPlantActor,
  applicationCapability: Capability
): boolean {
  return holdsSeatFor(seatFieldsOf(actor), applicationCapability);
}

/**
 * Filter trusted registrations before exposing them to policy or a model.
 *
 * The result derives only from the authenticated actor and `holdsSeatFor`.
 * Context, conversation state, recipe state, and model output are deliberately
 * absent from the authority decision.
 */
export function eligibleEvryCapabilitiesFor(
  actor: EvryPlantActor
): readonly EvryCapabilityRegistration[] {
  return [...REGISTRY.values()].filter((registration) =>
    actorHolds(actor, registration.applicationCapability)
  );
}

/**
 * Revalidate a selected registration with a freshly minted actor.
 *
 * Callers pass only the identity. This function resolves it against the private
 * generated registry after re-minting the actor, immediately before a read,
 * plan, or execution step. A prior plan's registration or assertion that
 * permission existed is not an input.
 */
export async function authorizeEvryCapability(
  identity: string
): Promise<EvryCapabilityAuthorization | null> {
  const actor = await requireEvryPlantViewer();
  const registration = REGISTRY.get(identity);

  if (!registration || !actorHolds(actor, registration.applicationCapability)) {
    return null;
  }

  const authorization: EvryCapabilityAuthorization = {
    actor,
    registration,
    [EVRY_CAPABILITY_AUTHORIZATION]: true,
  };

  return Object.freeze(authorization);
}
