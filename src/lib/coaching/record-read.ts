import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  persons,
  households,
  personTags,
  tags,
  skillsInventory,
  tasks,
  churchMeetings,
  meetingAttendance,
  meetingEvaluations,
  ministryTeams,
  teamRoles,
  teamMemberships,
  type User,
} from "@/db/schema";
import { readCoachedPlant } from "./read";
import type { CoachedCollection } from "./collections";

export async function readCoachedRecord(
  user: Pick<User, "id">,
  churchId: string,
  collection: CoachedCollection,
  id: string
) {
  if (!z.uuid().safeParse(id).success) return null;
  const plant = await readCoachedPlant(user, churchId);
  if (!plant) return null;
  switch (collection) {
    case "people": {
      const [person] = await db
        .select({
          id: persons.id,
          firstName: persons.firstName,
          lastName: persons.lastName,
          email: persons.email,
          phone: persons.phone,
          addressLine1: persons.addressLine1,
          addressLine2: persons.addressLine2,
          city: persons.city,
          state: persons.state,
          postalCode: persons.postalCode,
          country: persons.country,
          status: persons.status,
          source: persons.source,
          sourceDetails: persons.sourceDetails,
          notes: persons.notes,
          backgroundCheckStatus: persons.backgroundCheckStatus,
          householdName: households.name,
          householdRole: persons.householdRole,
        })
        .from(persons)
        .leftJoin(
          households,
          and(
            eq(persons.householdId, households.id),
            eq(households.churchId, churchId)
          )
        )
        .where(
          and(
            eq(persons.id, id),
            eq(persons.churchId, churchId),
            isNull(persons.deletedAt)
          )
        )
        .limit(1);
      if (!person) return null;
      const [personTagRows, skills] = await Promise.all([
        db
          .select({ id: tags.id, name: tags.name })
          .from(personTags)
          .innerJoin(
            tags,
            and(eq(personTags.tagId, tags.id), eq(tags.churchId, churchId))
          )
          .where(
            and(eq(personTags.churchId, churchId), eq(personTags.personId, id))
          )
          .orderBy(asc(tags.name), asc(tags.id)),
        db
          .select({
            id: skillsInventory.id,
            name: skillsInventory.skillName,
            proficiency: skillsInventory.proficiency,
            notes: skillsInventory.notes,
          })
          .from(skillsInventory)
          .where(
            and(
              eq(skillsInventory.churchId, churchId),
              eq(skillsInventory.personId, id)
            )
          )
          .orderBy(asc(skillsInventory.skillName), asc(skillsInventory.id)),
      ]);
      return {
        kind: "people" as const,
        plant,
        person,
        tags: personTagRows,
        skills,
      };
    }
    case "tasks": {
      const [task] = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          dueDate: tasks.dueDate,
          dueTime: tasks.dueTime,
          category: tasks.category,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.churchId, churchId),
            eq(tasks.id, id),
            isNull(tasks.deletedAt),
            isNull(tasks.parentTaskId)
          )
        )
        .limit(1);
      if (!task) return null;
      const steps = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.churchId, churchId),
            eq(tasks.parentTaskId, id),
            isNull(tasks.deletedAt)
          )
        )
        .orderBy(asc(tasks.createdAt), asc(tasks.id));
      return { kind: "tasks" as const, plant, task, steps };
    }
    case "meetings": {
      const [meeting] = await db
        .select({
          id: churchMeetings.id,
          title: churchMeetings.title,
          type: churchMeetings.type,
          datetime: churchMeetings.datetime,
          status: churchMeetings.status,
          locationName: churchMeetings.locationName,
          locationAddress: churchMeetings.locationAddress,
          estimatedAttendance: churchMeetings.estimatedAttendance,
          actualAttendance: churchMeetings.actualAttendance,
          durationMinutes: churchMeetings.durationMinutes,
          notes: churchMeetings.notes,
        })
        .from(churchMeetings)
        .where(
          and(eq(churchMeetings.churchId, churchId), eq(churchMeetings.id, id))
        )
        .limit(1);
      if (!meeting) return null;
      const [attendance, evaluations] = await Promise.all([
        db
          .select({
            id: meetingAttendance.id,
            personId: persons.id,
            firstName: persons.firstName,
            lastName: persons.lastName,
            status: meetingAttendance.status,
            response: meetingAttendance.responseStatus,
            notes: meetingAttendance.notes,
          })
          .from(meetingAttendance)
          .innerJoin(
            persons,
            and(
              eq(meetingAttendance.personId, persons.id),
              eq(persons.churchId, churchId),
              isNull(persons.deletedAt)
            )
          )
          .where(
            and(
              eq(meetingAttendance.churchId, churchId),
              eq(meetingAttendance.meetingId, id)
            )
          )
          .orderBy(asc(persons.lastName), asc(persons.id)),
        db
          .select({
            totalScore: meetingEvaluations.totalScore,
            notes: meetingEvaluations.notes,
          })
          .from(meetingEvaluations)
          .where(
            and(
              eq(meetingEvaluations.churchId, churchId),
              eq(meetingEvaluations.meetingId, id)
            )
          ),
      ]);
      return {
        kind: "meetings" as const,
        plant,
        meeting,
        attendance,
        evaluation: evaluations[0] ?? null,
      };
    }
    case "teams": {
      const [team] = await db
        .select({
          id: ministryTeams.id,
          name: ministryTeams.name,
          description: ministryTeams.description,
          status: ministryTeams.status,
        })
        .from(ministryTeams)
        .where(
          and(eq(ministryTeams.churchId, churchId), eq(ministryTeams.id, id))
        )
        .limit(1);
      if (!team) return null;
      const [roles, roster] = await Promise.all([
        db
          .select({
            id: teamRoles.id,
            name: teamRoles.name,
            description: teamRoles.description,
            status: teamRoles.status,
          })
          .from(teamRoles)
          .where(
            and(eq(teamRoles.churchId, churchId), eq(teamRoles.teamId, id))
          )
          .orderBy(asc(teamRoles.sortOrder), asc(teamRoles.id)),
        db
          .select({
            id: teamMemberships.id,
            personId: persons.id,
            firstName: persons.firstName,
            lastName: persons.lastName,
            status: teamMemberships.status,
            role: teamRoles.name,
          })
          .from(teamMemberships)
          .innerJoin(
            persons,
            and(
              eq(teamMemberships.personId, persons.id),
              eq(persons.churchId, churchId),
              isNull(persons.deletedAt)
            )
          )
          .leftJoin(
            teamRoles,
            and(
              eq(teamMemberships.roleId, teamRoles.id),
              eq(teamRoles.churchId, churchId),
              eq(teamRoles.teamId, id)
            )
          )
          .where(
            and(
              eq(teamMemberships.churchId, churchId),
              eq(teamMemberships.teamId, id)
            )
          )
          .orderBy(
            asc(persons.lastName),
            asc(persons.id),
            asc(teamMemberships.id)
          ),
      ]);
      return { kind: "teams" as const, plant, team, roles, roster };
    }
  }
}
export type CoachedRecord = NonNullable<
  Awaited<ReturnType<typeof readCoachedRecord>>
>;
