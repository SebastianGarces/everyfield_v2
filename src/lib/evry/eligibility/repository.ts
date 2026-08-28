import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { persons } from "@/db/schema";

import {
  authorizeEvryCapability,
  EVRY_PEOPLE_READ_PROBE_IDENTITY,
  EVRY_PEOPLE_WRITE_PROBE_IDENTITY,
  type EvryCapabilityAuthorization,
} from "./capabilities";

type EvryPersonTarget = Readonly<{
  id: string;
  displayName: string;
}>;

export type EvryPersonReadResult =
  | Readonly<{ status: "available"; person: EvryPersonTarget }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "refused" }>;

export type EvryPersonProposalResult =
  | Readonly<{
      status: "available";
      proposal: Readonly<{
        kind: "people.update";
        target: EvryPersonTarget;
      }>;
    }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "refused" }>;

async function findPersonInAuthorizedPlant(
  authorization: EvryCapabilityAuthorization,
  personId: string
): Promise<EvryPersonTarget | null> {
  const [person] = await db
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(persons)
    .where(
      and(
        eq(persons.id, personId),
        eq(persons.churchId, authorization.actor.plantId)
      )
    )
    .limit(1);

  return person
    ? {
        id: person.id,
        displayName: `${person.firstName} ${person.lastName}`.trim(),
      }
    : null;
}

/** A real plant-scoped read used by the request-level eligibility proof. */
export async function readEvryPerson(
  personId: string
): Promise<EvryPersonReadResult> {
  const authorization = await authorizeEvryCapability(
    EVRY_PEOPLE_READ_PROBE_IDENTITY
  );
  if (
    !authorization ||
    authorization.registration.applicationCapability !== "read"
  ) {
    return { status: "refused" };
  }

  const person = await findPersonInAuthorizedPlant(authorization, personId);
  return person ? { status: "available", person } : { status: "unavailable" };
}

/** Resolve the target for a proposed write without performing the write. */
export async function proposeEvryPersonUpdate(
  personId: string
): Promise<EvryPersonProposalResult> {
  const authorization = await authorizeEvryCapability(
    EVRY_PEOPLE_WRITE_PROBE_IDENTITY
  );
  if (
    !authorization ||
    authorization.registration.applicationCapability !== "people.write"
  ) {
    return { status: "refused" };
  }

  const target = await findPersonInAuthorizedPlant(authorization, personId);
  return target
    ? { status: "available", proposal: { kind: "people.update", target } }
    : { status: "unavailable" };
}
