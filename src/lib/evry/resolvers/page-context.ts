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
import { meetingDisplayTitle } from "@/lib/meetings/labels";

import type { EvryPageContext, EvryResolvedPageContext } from "./contract";

const recordIdSchema = z.string().uuid();

function safeDisplayLabel(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  return [...(normalized || fallback)].slice(0, 160).join("");
}

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
            label: safeDisplayLabel(
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
            label: safeDisplayLabel(
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
            label: safeDisplayLabel(record.name, "Team record"),
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
            label: safeDisplayLabel(record.title, "Task record"),
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
