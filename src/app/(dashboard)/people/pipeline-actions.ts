"use server";

import { db } from "@/db";
import { persons } from "@/db/schema/people";
import type { ActionResult } from "@/lib/people/types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withChurchSession } from "./action-context";

/**
 * Persist the order of people within a pipeline column.
 * Each person ID in the array gets pipeline_sort_order = its index.
 */
export async function reorderPipelineAction(
  orderedPersonIds: string[]
): Promise<ActionResult<void>> {
  return withChurchSession(
    "people.write",
    "reorderPipelineAction",
    { fallback: "Failed to reorder pipeline" },
    async ({ churchId }) => {
      if (orderedPersonIds.length === 0) {
        return { success: true, data: undefined };
      }

      // Build a single UPDATE using a CASE expression for efficiency
      const whenClauses = orderedPersonIds
        .map((id, idx) => sql`WHEN ${id} THEN ${idx}`)
        .reduce((acc, clause) => sql`${acc} ${clause}`);

      await db
        .update(persons)
        .set({
          pipelineSortOrder: sql<number>`CASE id ${whenClauses} ELSE ${persons.pipelineSortOrder} END`,
        })
        .where(
          and(
            eq(persons.churchId, churchId),
            inArray(persons.id, orderedPersonIds)
          )
        );

      revalidatePath("/people");
      return { success: true, data: undefined };
    }
  );
}
