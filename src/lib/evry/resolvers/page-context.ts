import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  churchMeetings,
  launches,
  ministryTeams,
  persons,
  tasks,
} from "@/db/schema";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import type { EvryPageContext } from "./contract";

const recordIdSchema = z.string().uuid();

async function scopedRecordId(
  actor: EvryPlantActor,
  pageContext: EvryPageContext
): Promise<string | null> {
  const parsedRecordId = recordIdSchema.safeParse(pageContext.recordId);

  switch (pageContext.kind) {
    case "person": {
      if (!parsedRecordId.success) return null;
      const [record] = await db
        .select({ id: persons.id })
        .from(persons)
        .where(
          and(
            eq(persons.id, parsedRecordId.data),
            eq(persons.churchId, actor.plantId),
            isNull(persons.deletedAt)
          )
        )
        .limit(1);
      return record?.id ?? null;
    }
    case "meeting": {
      if (!parsedRecordId.success) return null;
      const [record] = await db
        .select({ id: churchMeetings.id })
        .from(churchMeetings)
        .where(
          and(
            eq(churchMeetings.id, parsedRecordId.data),
            eq(churchMeetings.churchId, actor.plantId)
          )
        )
        .limit(1);
      return record?.id ?? null;
    }
    case "team": {
      if (!parsedRecordId.success) return null;
      const [record] = await db
        .select({ id: ministryTeams.id })
        .from(ministryTeams)
        .where(
          and(
            eq(ministryTeams.id, parsedRecordId.data),
            eq(ministryTeams.churchId, actor.plantId)
          )
        )
        .limit(1);
      return record?.id ?? null;
    }
    case "task": {
      if (!parsedRecordId.success) return null;
      const [record] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.id, parsedRecordId.data),
            eq(tasks.churchId, actor.plantId),
            isNull(tasks.deletedAt)
          )
        )
        .limit(1);
      return record?.id ?? null;
    }
    case "launch": {
      if (pageContext.recordId !== "current") return null;
      const [record] = await db
        .select({ id: launches.id })
        .from(launches)
        .where(eq(launches.churchId, actor.plantId))
        .limit(1);
      return record?.id ?? null;
    }
  }
}

/**
 * Resolve a browser-supplied context hint inside the authenticated plant.
 *
 * A foreign, stale, or invented id becomes no context. The caller receives no
 * distinction among those cases, and the resulting value contains only a row
 * proven to belong to the actor's plant. Capability selection and execution
 * still reauthorize independently; this function grants no authority.
 */
export async function resolveAuthorizedEvryPageContext(input: {
  actor: EvryPlantActor;
  pageContext: EvryPageContext | null;
}): Promise<EvryPageContext | null> {
  if (input.pageContext === null) return null;
  const recordId = await scopedRecordId(input.actor, input.pageContext);
  return recordId === null ? null : { kind: input.pageContext.kind, recordId };
}
