// Assignment consent is independent of oversight sharing. Explicit projections
// exclude account credentials, storage keys and personal planter check-ins.
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  churches,
  persons,
  tasks,
  churchMeetings,
  ministryTeams,
  type User,
} from "@/db/schema";
import { coachesPlant } from "./assignments";
import { COACHED_PAGE_SIZE, type CoachedCollection } from "./collections";

export async function readCoachedPlant(
  user: Pick<User, "id">,
  churchId: string
) {
  if (!z.uuid().safeParse(churchId).success) return null;
  if (!(await coachesPlant(user.id, churchId))) return null;
  const [church] = await db
    .select({
      churchId: churches.id,
      churchName: churches.name,
      currentPhase: churches.currentPhase,
    })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);
  return church ?? null;
}
export type CoachedPlant = NonNullable<
  Awaited<ReturnType<typeof readCoachedPlant>>
>;
export type CoachedRow = { id: string; name: string; status: string };

export async function readCoachedCollection(
  user: Pick<User, "id">,
  churchId: string,
  collection: CoachedCollection,
  page: number
) {
  const plant = await readCoachedPlant(user, churchId);
  if (
    !plant ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    (page - 1) * COACHED_PAGE_SIZE > 2147483647
  )
    return null;
  const offset = (page - 1) * COACHED_PAGE_SIZE;
  const limit = COACHED_PAGE_SIZE + 1;
  let rows: CoachedRow[];
  // Every order ends with the unique ID, including names/dates that tie.
  switch (collection) {
    case "people": {
      const people = await db
        .select({
          id: persons.id,
          firstName: persons.firstName,
          lastName: persons.lastName,
          status: persons.status,
        })
        .from(persons)
        .where(and(eq(persons.churchId, churchId), isNull(persons.deletedAt)))
        .orderBy(asc(persons.lastName), asc(persons.firstName), asc(persons.id))
        .limit(limit)
        .offset(offset);
      rows = people.map((person) => ({
        id: person.id,
        name: `${person.firstName} ${person.lastName}`,
        status: person.status,
      }));
      break;
    }
    case "tasks":
      rows = await db
        .select({ id: tasks.id, name: tasks.title, status: tasks.status })
        .from(tasks)
        .where(
          and(
            eq(tasks.churchId, churchId),
            isNull(tasks.deletedAt),
            isNull(tasks.parentTaskId)
          )
        )
        .orderBy(asc(tasks.title), asc(tasks.id))
        .limit(limit)
        .offset(offset);
      break;
    case "meetings": {
      const meetings = await db
        .select({
          id: churchMeetings.id,
          title: churchMeetings.title,
          type: churchMeetings.type,
          status: churchMeetings.status,
        })
        .from(churchMeetings)
        .where(eq(churchMeetings.churchId, churchId))
        .orderBy(asc(churchMeetings.datetime), asc(churchMeetings.id))
        .limit(limit)
        .offset(offset);
      rows = meetings.map((meeting) => ({
        id: meeting.id,
        name: meeting.title || `${meeting.type} meeting`,
        status: meeting.status,
      }));
      break;
    }
    case "teams":
      rows = await db
        .select({
          id: ministryTeams.id,
          name: ministryTeams.name,
          status: ministryTeams.status,
        })
        .from(ministryTeams)
        .where(eq(ministryTeams.churchId, churchId))
        .orderBy(asc(ministryTeams.name), asc(ministryTeams.id))
        .limit(limit)
        .offset(offset);
  }
  return {
    plant,
    rows: rows.slice(0, COACHED_PAGE_SIZE),
    hasNext: rows.length > COACHED_PAGE_SIZE,
    page,
  };
}
