import { db } from "@/db";
import { churchMeetings, ministryTeams, persons } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

export const TASK_RELATION_ERROR =
  "Choose a person, meeting or team in this plant.";
export const MANAGED_TASK_RELATION_ERROR =
  "This task's relation is managed by its meeting.";
export type TaskRelationOption = {
  id: string;
  label: string;
  type: "person" | "meeting" | "team";
};

/** The picker and write guard read the same live, church-scoped population. */
export function taskRelationQuery(
  churchId: string,
  type: TaskRelationOption["type"],
  id?: string
) {
  switch (type) {
    case "person":
      return db
        .select({
          id: persons.id,
          label: sql<string>`concat_ws(' ', ${persons.firstName}, ${persons.lastName})`,
        })
        .from(persons)
        .where(
          and(
            eq(persons.churchId, churchId),
            isNull(persons.deletedAt),
            id ? eq(persons.id, id) : undefined
          )
        );
    case "meeting":
      return db
        .select({
          id: churchMeetings.id,
          label: sql<string>`coalesce(${churchMeetings.title}, replace(${churchMeetings.type}, '_', ' ')) || ' · ' || to_char(${churchMeetings.datetime}, 'YYYY-MM-DD')`,
        })
        .from(churchMeetings)
        .where(
          and(
            eq(churchMeetings.churchId, churchId),
            id ? eq(churchMeetings.id, id) : undefined
          )
        );
    case "team":
      return db
        .select({ id: ministryTeams.id, label: ministryTeams.name })
        .from(ministryTeams)
        .where(
          and(
            eq(ministryTeams.churchId, churchId),
            id ? eq(ministryTeams.id, id) : undefined
          )
        );
  }
}

export async function listTaskRelationOptions(
  churchId: string
): Promise<TaskRelationOption[]> {
  const types = ["person", "meeting", "team"] as const;
  const groups = await Promise.all(
    types.map(async (type) =>
      (await taskRelationQuery(churchId, type)).map((row) => ({ ...row, type }))
    )
  );
  return groups.flat().sort((a, b) => a.label.localeCompare(b.label));
}

export async function assertTaskRelation(
  churchId: string,
  type: string | null | undefined,
  id: string | null | undefined
): Promise<void> {
  if (!type && !id) return;
  const parsedType = z.enum(["person", "meeting", "team"]).safeParse(type);
  if (!parsedType.success || !z.string().uuid().safeParse(id).success || !id)
    throw new Error(TASK_RELATION_ERROR);
  const [row] = await taskRelationQuery(churchId, parsedType.data, id).limit(1);
  if (!row) throw new Error(TASK_RELATION_ERROR);
}
