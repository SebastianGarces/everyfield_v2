import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  churchMeetings,
  launches,
  ministryTeams,
  persons,
  plantAssessments,
  tasks,
} from "@/db/schema";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { meetingDisplayTitle } from "@/lib/meetings/labels";

import {
  safeEvryPageContextLabel,
  type EvryPageContext,
  type EvryResolvedPageContext,
} from "./contract";

const recordIdSchema = z.string().uuid();

async function scopedRecord(
  actor: EvryPlantActor,
  pageContext: EvryPageContext
): Promise<Readonly<{ recordId: string; label: string }> | null> {
  const parsedRecordId = recordIdSchema.safeParse(pageContext.recordId);

  switch (pageContext.kind) {
    case "person": {
      if (!parsedRecordId.success) return null;
      const [record] = await db
        .select({
          id: persons.id,
          firstName: persons.firstName,
          lastName: persons.lastName,
        })
        .from(persons)
        .where(
          and(
            eq(persons.id, parsedRecordId.data),
            eq(persons.churchId, actor.plantId),
            isNull(persons.deletedAt)
          )
        )
        .limit(1);
      return record
        ? {
            recordId: record.id,
            label: safeEvryPageContextLabel(
              `${record.firstName} ${record.lastName}`,
              "Person record"
            ),
          }
        : null;
    }
    case "meeting": {
      if (!parsedRecordId.success) return null;
      const [record] = await db
        .select({
          id: churchMeetings.id,
          type: churchMeetings.type,
          title: churchMeetings.title,
          meetingNumber: churchMeetings.meetingNumber,
          teamName: ministryTeams.name,
        })
        .from(churchMeetings)
        .leftJoin(
          ministryTeams,
          and(
            eq(ministryTeams.id, churchMeetings.teamId),
            eq(ministryTeams.churchId, actor.plantId)
          )
        )
        .where(
          and(
            eq(churchMeetings.id, parsedRecordId.data),
            eq(churchMeetings.churchId, actor.plantId)
          )
        )
        .limit(1);
      return record
        ? {
            recordId: record.id,
            label: safeEvryPageContextLabel(
              meetingDisplayTitle(record),
              "Meeting record"
            ),
          }
        : null;
    }
    case "team": {
      if (!parsedRecordId.success) return null;
      const [record] = await db
        .select({ id: ministryTeams.id, name: ministryTeams.name })
        .from(ministryTeams)
        .where(
          and(
            eq(ministryTeams.id, parsedRecordId.data),
            eq(ministryTeams.churchId, actor.plantId)
          )
        )
        .limit(1);
      return record
        ? {
            recordId: record.id,
            label: safeEvryPageContextLabel(record.name, "Team record"),
          }
        : null;
    }
    case "task": {
      if (!parsedRecordId.success) return null;
      const [record] = await db
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(
          and(
            eq(tasks.id, parsedRecordId.data),
            eq(tasks.churchId, actor.plantId),
            isNull(tasks.deletedAt)
          )
        )
        .limit(1);
      return record
        ? {
            recordId: record.id,
            label: safeEvryPageContextLabel(record.title, "Task record"),
          }
        : null;
    }
    case "launch": {
      if (pageContext.recordId !== "current") return null;
      const [record] = await db
        .select({ id: launches.id })
        .from(launches)
        .where(eq(launches.churchId, actor.plantId))
        .limit(1);
      return record ? { recordId: record.id, label: "Launch Sunday" } : null;
    }
    case "plant_intelligence": {
      if (pageContext.recordId !== "current") return null;
      const [record] = await db
        .select({
          id: plantAssessments.id,
          generatedAt: plantAssessments.generatedAt,
        })
        .from(plantAssessments)
        .where(
          and(
            eq(plantAssessments.churchId, actor.plantId),
            eq(plantAssessments.status, "complete")
          )
        )
        .orderBy(desc(plantAssessments.generatedAt), desc(plantAssessments.id))
        .limit(1);
      return record
        ? {
            recordId: record.id,
            label: safeEvryPageContextLabel(
              `Plant Intelligence · ${record.generatedAt.toISOString()}`,
              "Plant Intelligence assessment"
            ),
          }
        : null;
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
}): Promise<EvryResolvedPageContext | null> {
  if (input.pageContext === null) return null;
  const record = await scopedRecord(input.actor, input.pageContext);
  return record === null ? null : { kind: input.pageContext.kind, ...record };
}
