import communicationInventory from "@/lib/evry/capabilities/communication/inventory.generated.json";
import peopleInventory from "@/lib/evry/capabilities/people/inventory.generated.json";
import meetingsInventory from "@/lib/evry/capabilities/meetings/inventory.generated.json";
import { MEETINGS_OPERATION_REGISTRATIONS } from "@/lib/evry/capabilities/meetings/registrations";
import parityInventory from "@/lib/evry/capabilities/inventory.generated.json";
import {
  ALL_CAPABILITIES,
  holdsSeatFor,
  type Capability,
} from "@/lib/auth/seat-rules";
import { tenancyColumns, type SeatFields } from "@/lib/auth/tenancy";
import { isUnauthorized } from "@/lib/auth/unauthorized";

import {
  EvryPlantViewerRefusalError,
  requireEvryPlantViewer,
  requireFreshEvryPlantViewer,
  type EvryPlantActor,
} from "./viewer";
import {
  createEvryCapabilityRegistry,
  defineEvryCapabilityRegistration,
  type EvryAuthoritativeCapabilitySurface,
  type EvryCapabilityRegistration,
  type EvryEffectCapabilityRegistration,
  type EvryReadCapabilityRegistration,
} from "./registry";

export {
  createEvryCapabilityRegistry,
  defineEvryCapabilityRegistration,
  type EvryCapabilityOperationKind,
  type EvryCapabilityRegistration,
  type EvryCapabilityRegistry,
  type EvryAuthoritativeCapabilitySurface,
  type EvryEffectCapabilityRegistration,
  type EvryReadCapabilityRegistration,
} from "./registry";

const EVRY_CAPABILITY_AUTHORIZATION: unique symbol = Symbol(
  "EvryCapabilityAuthorization"
);
const EVRY_READ_CAPABILITY_AUTHORIZATION: unique symbol = Symbol(
  "EvryReadCapabilityAuthorization"
);
const EVRY_EFFECT_CAPABILITY_AUTHORIZATION: unique symbol = Symbol(
  "EvryEffectCapabilityAuthorization"
);

const APPLICATION_CAPABILITIES = new Set<string>(ALL_CAPABILITIES);

function isApplicationCapability(value: string): value is Capability {
  return APPLICATION_CAPABILITIES.has(value);
}

/** A fresh session-backed authorization for one trusted registration. */
export type EvryCapabilityAuthorization = Readonly<{
  actor: EvryPlantActor;
  registration: EvryCapabilityRegistration;
  [EVRY_CAPABILITY_AUTHORIZATION]: true;
}>;

/** Fresh authorization that can reach a read adapter and no effect adapter. */
export type EvryReadCapabilityAuthorization = Readonly<{
  actor: EvryPlantActor;
  registration: EvryReadCapabilityRegistration;
  [EVRY_READ_CAPABILITY_AUTHORIZATION]: true;
}>;

/** Fresh authorization that may reach a lasting-effect adapter. */
export type EvryEffectCapabilityAuthorization = Readonly<{
  actor: EvryPlantActor;
  registration: EvryEffectCapabilityRegistration;
  [EVRY_EFFECT_CAPABILITY_AUTHORIZATION]: true;
}>;

function generatedPeopleRegistrations(): EvryCapabilityRegistration[] {
  return peopleInventory.capabilities.map((capability) => {
    const [firstSurface, ...otherSurfaces] = capability.surfaceIdentities;
    if (
      !isApplicationCapability(capability.applicationCapability) ||
      !firstSurface ||
      (capability.operationKind !== "read" &&
        capability.operationKind !== "effect")
    ) {
      throw new Error(
        `Invalid generated People capability: ${capability.identity}`
      );
    }
    return defineEvryCapabilityRegistration({
      identity: capability.identity,
      surfaceIdentities: [firstSurface, ...otherSurfaces],
      parityCapability: capability.parityCapability,
      operationKind: capability.operationKind,
      applicationCapability: capability.applicationCapability,
    });
  });
}

function generatedCommunicationRegistrations(): EvryCapabilityRegistration[] {
  return communicationInventory.capabilities.map((capability) => {
    const [firstSurface, ...otherSurfaces] = capability.surfaceIdentities;
    if (
      !isApplicationCapability(capability.applicationCapability) ||
      !firstSurface ||
      (capability.operationKind !== "read" &&
        capability.operationKind !== "effect")
    ) {
      throw new Error(
        `Invalid generated Communication capability: ${capability.identity}`
      );
    }
    return defineEvryCapabilityRegistration({
      identity: capability.identity,
      surfaceIdentities: [firstSurface, ...otherSurfaces],
      parityCapability: capability.parityCapability,
      operationKind: capability.operationKind,
      applicationCapability: capability.applicationCapability,
    });
  });
}

/** Explicit shared proof registrations, replaced in place by owning packs. */
const REFERENCE_REGISTRATIONS = [
  defineEvryCapabilityRegistration({
    identity: "tasks.list",
    surfaceIdentities: [
      "action:src/app/(dashboard)/tasks/actions.ts → loadMoreTasksAction",
    ],
    parityCapability: "tasks",
    operationKind: "read",
    applicationCapability: "read",
  }),
  defineEvryCapabilityRegistration({
    identity: "tasks.complete",
    surfaceIdentities: [
      "action:src/app/(dashboard)/tasks/actions.ts → completeTaskAction",
    ],
    parityCapability: "tasks",
    operationKind: "effect",
    applicationCapability: "tasks.own",
  }),
  defineEvryCapabilityRegistration({
    identity: "launch.schedule",
    surfaceIdentities: [
      "action:src/app/(dashboard)/launch/actions.ts → scheduleLaunchAction",
    ],
    parityCapability: "launch",
    operationKind: "effect",
    applicationCapability: "launch.schedule",
  }),
] as const;

function generatedPeopleSurfaces(): EvryAuthoritativeCapabilitySurface[] {
  return peopleInventory.entries.flatMap((entry) => {
    if (
      entry.classification.state !== "supported" ||
      (entry.operationKind !== "read" && entry.operationKind !== "effect") ||
      entry.applicationCapability === null ||
      !isApplicationCapability(entry.applicationCapability)
    ) {
      return [];
    }
    return [
      {
        identity: entry.identity,
        capabilityIdentity: entry.capabilityIdentity,
        parityCapability: "people",
        operationKind: entry.operationKind,
        applicationCapability: entry.applicationCapability,
      },
    ];
  });
}

function generatedCommunicationSurfaces(): EvryAuthoritativeCapabilitySurface[] {
  return communicationInventory.entries.flatMap((entry) => {
    if (
      entry.classification.state !== "supported" ||
      (entry.operationKind !== "read" && entry.operationKind !== "effect") ||
      entry.applicationCapability === null ||
      !isApplicationCapability(entry.applicationCapability)
    ) {
      return [];
    }
    return [
      {
        identity: entry.identity,
        capabilityIdentity: entry.capabilityIdentity,
        parityCapability: "communication",
        operationKind: entry.operationKind,
        applicationCapability: entry.applicationCapability,
      },
    ];
  });
}

function referenceSurfaces(): EvryAuthoritativeCapabilitySurface[] {
  return REFERENCE_REGISTRATIONS.flatMap((registration) =>
    registration.surfaceIdentities.map((surfaceIdentity) => {
      const source = parityInventory.entries.find(
        ({ identity }) => identity === surfaceIdentity
      );
      if (
        !source ||
        source.classification.state !== "supported" ||
        source.parityCapability !== registration.parityCapability ||
        source.applicationCapability !== registration.applicationCapability
      ) {
        throw new Error(
          `Reference Evry capability drifted from ${surfaceIdentity}`
        );
      }
      return {
        identity: surfaceIdentity,
        capabilityIdentity: registration.identity,
        parityCapability: registration.parityCapability,
        operationKind: registration.operationKind,
        applicationCapability: registration.applicationCapability,
      };
    })
  );
}

function generatedMeetingsSurfaces(): EvryAuthoritativeCapabilitySurface[] {
  return meetingsInventory.entries.flatMap((entry) => {
    if (entry.classification.state !== "supported") return [];
    if (
      !entry.capabilityIdentity ||
      (entry.operationKind !== "read" && entry.operationKind !== "effect") ||
      !entry.applicationCapability ||
      !isApplicationCapability(entry.applicationCapability)
    ) {
      throw new Error(`Invalid generated Meetings surface: ${entry.identity}`);
    }
    return [
      {
        identity: entry.identity,
        capabilityIdentity: entry.capabilityIdentity,
        parityCapability: entry.parityCapability,
        operationKind: entry.operationKind,
        applicationCapability: entry.applicationCapability,
      },
    ];
  });
}

const REGISTRY = createEvryCapabilityRegistry({
  registrations: [
    ...generatedPeopleRegistrations(),
    ...generatedCommunicationRegistrations(),
    ...MEETINGS_OPERATION_REGISTRATIONS,
    ...REFERENCE_REGISTRATIONS,
  ],
  authoritativeSurfaces: [
    ...generatedPeopleSurfaces(),
    ...generatedCommunicationSurfaces(),
    ...generatedMeetingsSurfaces(),
    ...referenceSurfaces(),
  ],
});

function isReadRegistration(
  registration: EvryCapabilityRegistration
): registration is EvryReadCapabilityRegistration {
  return registration.operationKind === "read";
}

function isEffectRegistration(
  registration: EvryCapabilityRegistration
): registration is EvryEffectCapabilityRegistration {
  return registration.operationKind === "effect";
}

export const EVRY_PEOPLE_READ_PROBE_IDENTITY =
  "people.crm.people.load-more-people";

export const EVRY_PEOPLE_WRITE_PROBE_IDENTITY =
  "people.crm.people.update-person";

export const EVRY_TASKS_READ_PROBE_IDENTITY = "tasks.list";
export const EVRY_TASKS_COMPLETE_PROBE_IDENTITY = "tasks.complete";
export const EVRY_LAUNCH_SCHEDULE_PROBE_IDENTITY = "launch.schedule";

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
  return REGISTRY.registrations().filter((registration) =>
    actorHolds(actor, registration.applicationCapability)
  );
}

/** Resolve a semantic identity through the closed production registry. */
export function evryCapabilityRegistrationFor(
  identity: string
): EvryCapabilityRegistration | null {
  return REGISTRY.registrationFor(identity);
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
  const registration = REGISTRY.registrationFor(identity);

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

/** Check a pack registration against the generated inventory before exposure. */
export function isEvryReadCapabilityIdentity(identity: string): boolean {
  const registration = REGISTRY.registrationFor(identity);
  return registration !== null && isReadRegistration(registration);
}

/** Only inventory-backed application effects may be installed in an executor. */
export function isEvryEffectCapabilityIdentity(identity: string): boolean {
  const registration = REGISTRY.registrationFor(identity);
  return registration !== null && isEffectRegistration(registration);
}

/** Re-mint the actor and recheck that the selected inventory entry is a read. */
export async function authorizeEvryReadCapability(
  identity: string
): Promise<EvryReadCapabilityAuthorization | null> {
  let actor: EvryPlantActor;
  try {
    actor = await requireEvryPlantViewer();
  } catch (error) {
    if (error instanceof EvryPlantViewerRefusalError || isUnauthorized(error)) {
      return null;
    }
    throw error;
  }
  const registration = REGISTRY.registrationFor(identity);

  if (
    !registration ||
    !isReadRegistration(registration) ||
    !actorHolds(actor, registration.applicationCapability)
  ) {
    return null;
  }

  return Object.freeze({
    actor,
    registration,
    [EVRY_READ_CAPABILITY_AUTHORIZATION]: true as const,
  });
}

/** Re-mint the actor and recheck a selected lasting-effect registration. */
export async function authorizeEvryEffectCapability(
  identity: string
): Promise<EvryEffectCapabilityAuthorization | null> {
  let actor: EvryPlantActor;
  try {
    actor = await requireFreshEvryPlantViewer();
  } catch (error) {
    if (error instanceof EvryPlantViewerRefusalError || isUnauthorized(error)) {
      return null;
    }
    throw error;
  }
  const registration = REGISTRY.registrationFor(identity);

  if (
    !registration ||
    !isEffectRegistration(registration) ||
    !actorHolds(actor, registration.applicationCapability)
  ) {
    return null;
  }

  return Object.freeze({
    actor,
    registration,
    [EVRY_EFFECT_CAPABILITY_AUTHORIZATION]: true as const,
  });
}
