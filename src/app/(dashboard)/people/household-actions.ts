"use server";

import type { Household, HouseholdRole } from "@/db/schema";
import { logPersonActivity } from "@/lib/people/activity";
import {
  addToHousehold,
  createHouseholdWithHead,
  deleteHousehold,
  getHousehold,
  getHouseholdMembers,
  listHouseholds,
  propagateAddress,
  removeFromHousehold,
  updateHousehold,
} from "@/lib/people/household";
import { getPerson } from "@/lib/people/service";
import type { ActionResult, PersonForClient } from "@/lib/people/types";
import {
  householdCreateSchema,
  householdUpdateSchema,
} from "@/lib/validations/people";
import { revalidatePath } from "next/cache";
import { toFieldErrors, withChurchSession } from "./action-context";

/**
 * List all households for the church
 */
export async function listHouseholdsAction(): Promise<
  ActionResult<Household[]>
> {
  return withChurchSession(
    "read",
    "listHouseholdsAction",
    { fallback: "Failed to list households" },
    async ({ churchId }) => {
      const households = await listHouseholds(churchId);
      return { success: true, data: households };
    }
  );
}

/**
 * Create a household and add the person as its head, in one atomic batch
 * (ruling 410-4B). `usePersonAddress` decides whether the household copies
 * the person's address. Replaces both of the old shapes — the client-side
 * two-step (create household, then add person) and the from-person helper's
 * two sequential writes — either of whose second failure left an orphan
 * empty household.
 */
export async function createHouseholdWithHeadAction(
  personId: string,
  householdName: string,
  usePersonAddress: boolean
): Promise<ActionResult<{ household: Household; person: PersonForClient }>> {
  return withChurchSession(
    "people.write",
    "createHouseholdWithHeadAction",
    {
      known: { "Person not found": "Person not found or has been deleted" },
      fallback: "Failed to create household",
    },
    async ({ user, churchId }) => {
      const parsed = householdCreateSchema.safeParse({ name: householdName });
      if (!parsed.success) {
        return {
          success: false,
          error: "Validation failed",
          fieldErrors: toFieldErrors(parsed.error),
        };
      }

      const result = await createHouseholdWithHead(
        churchId,
        personId,
        parsed.data.name,
        usePersonAddress
      );

      // Log activity for household creation — the person created it
      // and heads it
      await logPersonActivity({
        churchId,
        personId,
        activityType: "household_created",
        metadata: {
          householdName: result.household.name,
          householdId: result.household.id,
          role: "head",
        },
        performedBy: user.id,
      });

      revalidatePath("/people");
      revalidatePath(`/people/${personId}`);
      return { success: true, data: result };
    }
  );
}

/**
 * Update an existing household
 */
export async function updateHouseholdAction(
  householdId: string,
  data: {
    name?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }
): Promise<ActionResult<Household>> {
  return withChurchSession(
    "people.write",
    "updateHouseholdAction",
    {
      fallback: "Failed to update household",
    },
    async ({ churchId }) => {
      const parsed = householdUpdateSchema.safeParse(data);
      if (!parsed.success) {
        return {
          success: false,
          error: "Validation failed",
          fieldErrors: toFieldErrors(parsed.error),
        };
      }

      const household = await updateHousehold(
        churchId,
        householdId,
        parsed.data
      );
      revalidatePath("/people");
      return { success: true, data: household };
    }
  );
}

/**
 * Delete a household (only if empty)
 */
export async function deleteHouseholdAction(
  householdId: string
): Promise<ActionResult<void>> {
  return withChurchSession(
    "people.write",
    "deleteHouseholdAction",
    {
      mapError: (error) =>
        error.message.includes("Cannot delete household with members")
          ? error.message
          : undefined,
      fallback: "Failed to delete household",
    },
    async ({ churchId }) => {
      await deleteHousehold(churchId, householdId);
      revalidatePath("/people");
      return { success: true, data: undefined };
    }
  );
}

/**
 * Add a person to a household
 */
export async function addToHouseholdAction(
  personId: string,
  householdId: string,
  role: HouseholdRole
): Promise<ActionResult<PersonForClient>> {
  return withChurchSession(
    "people.write",
    "addToHouseholdAction",
    {
      fallback: "Failed to add to household",
    },
    async ({ user, churchId }) => {
      // Get household info for activity logging
      const household = await getHousehold(churchId, householdId);
      if (!household) {
        return { success: false, error: "Household not found" };
      }

      const person = await addToHousehold(
        churchId,
        personId,
        householdId,
        role
      );

      // Log activity
      await logPersonActivity({
        churchId,
        personId,
        activityType: "household_joined",
        metadata: {
          householdName: household.name,
          householdId: household.id,
          role,
        },
        performedBy: user.id,
      });

      revalidatePath("/people");
      revalidatePath(`/people/${personId}`);
      return { success: true, data: person };
    }
  );
}

/**
 * Remove a person from their household
 */
export async function removeFromHouseholdAction(
  personId: string
): Promise<ActionResult<PersonForClient>> {
  return withChurchSession(
    "people.write",
    "removeFromHouseholdAction",
    {
      fallback: "Failed to remove from household",
    },
    async ({ user, churchId }) => {
      // Get person's current household info before removing
      const existingPerson = await getPerson(churchId, personId);
      if (!existingPerson) {
        return { success: false, error: "Person not found" };
      }

      let householdName: string | undefined;
      if (existingPerson.householdId) {
        const household = await getHousehold(
          churchId,
          existingPerson.householdId
        );
        householdName = household?.name;
      }

      const person = await removeFromHousehold(churchId, personId);

      // Log activity if they were in a household
      if (householdName) {
        await logPersonActivity({
          churchId,
          personId,
          activityType: "household_left",
          metadata: {
            householdName,
            householdId: existingPerson.householdId,
          },
          performedBy: user.id,
        });
      }

      revalidatePath("/people");
      revalidatePath(`/people/${personId}`);
      return { success: true, data: person };
    }
  );
}

/**
 * Copy household address to all members
 */
export async function propagateAddressAction(
  householdId: string
): Promise<ActionResult<number>> {
  return withChurchSession(
    "people.write",
    "propagateAddressAction",
    {
      fallback: "Failed to propagate address",
    },
    async ({ churchId }) => {
      const count = await propagateAddress(churchId, householdId);
      revalidatePath("/people");
      return { success: true, data: count };
    }
  );
}

/**
 * Get household members (for display)
 */
export async function getHouseholdMembersAction(
  householdId: string
): Promise<ActionResult<PersonForClient[]>> {
  return withChurchSession(
    "read",
    "getHouseholdMembersAction",
    { fallback: "Failed to get household members" },
    async ({ churchId }) => {
      const members = await getHouseholdMembers(churchId, householdId);
      return { success: true, data: members };
    }
  );
}
