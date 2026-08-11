import { db } from "@/db";
import {
  ministryTeams,
  teamMemberships,
  trainingPrograms,
  trainingCompletions,
  persons,
  type TrainingProgram,
  type NewTrainingProgram,
  type TrainingCompletion,
  type NewTrainingCompletion,
} from "@/db/schema";
import { and, eq, inArray, sql, asc } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export interface TrainingMatrixRow {
  personId: string;
  personName: string;
  completions: Record<string, boolean>;
}

/**
 * One training program as it applies to a single person: the program itself,
 * the team it belongs to (null = church-wide), and whether this person has a
 * `training_completions` row for it.
 */
export interface PersonTrainingItem {
  programId: string;
  programName: string;
  teamId: string | null;
  teamName: string | null;
  isRequired: boolean;
  completedAt: Date | null;
}

// ============================================================================
// Training Functions
// ============================================================================

/**
 * List training programs (optionally by team)
 */
export async function listTrainingPrograms(
  churchId: string,
  teamId?: string
): Promise<TrainingProgram[]> {
  const conditions = [eq(trainingPrograms.churchId, churchId)];

  if (teamId) {
    conditions.push(eq(trainingPrograms.teamId, teamId));
  }

  return db
    .select()
    .from(trainingPrograms)
    .where(and(...conditions))
    .orderBy(asc(trainingPrograms.name));
}

/**
 * Create a training program
 */
export async function createTrainingProgram(
  churchId: string,
  userId: string,
  data: {
    name: string;
    description?: string;
    teamId?: string;
    isRequired?: boolean;
  }
): Promise<TrainingProgram> {
  const [program] = await db
    .insert(trainingPrograms)
    .values({
      churchId,
      teamId: data.teamId ?? null,
      name: data.name,
      description: data.description ?? null,
      isRequired: data.isRequired ?? false,
      createdBy: userId,
    } satisfies NewTrainingProgram)
    .returning();

  return program;
}

/**
 * Mark training as complete for a person
 */
export async function markTrainingComplete(
  churchId: string,
  personId: string,
  programId: string,
  userId: string
): Promise<TrainingCompletion> {
  // Check for existing completion
  const existing = await db
    .select()
    .from(trainingCompletions)
    .where(
      and(
        eq(trainingCompletions.churchId, churchId),
        eq(trainingCompletions.personId, personId),
        eq(trainingCompletions.trainingProgramId, programId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    throw new Error("Training already completed");
  }

  const [completion] = await db
    .insert(trainingCompletions)
    .values({
      churchId,
      personId,
      trainingProgramId: programId,
      completedAt: new Date(),
      verifiedBy: userId,
      createdBy: userId,
    } satisfies NewTrainingCompletion)
    .returning();

  return completion;
}

/**
 * Get every training program that applies to one person, with completion state.
 *
 * A program applies when it is church-wide (`team_id IS NULL`), when it belongs
 * to a team the person is actively assigned to, or when the person already has
 * a completion row for it (so training earned on a team they later left still
 * shows as completed rather than silently disappearing).
 */
export async function getPersonTraining(
  churchId: string,
  personId: string
): Promise<PersonTrainingItem[]> {
  const [programs, completions, memberships] = await Promise.all([
    db
      .select()
      .from(trainingPrograms)
      .where(eq(trainingPrograms.churchId, churchId))
      .orderBy(asc(trainingPrograms.name)),
    db
      .select({
        trainingProgramId: trainingCompletions.trainingProgramId,
        completedAt: trainingCompletions.completedAt,
      })
      .from(trainingCompletions)
      .where(
        and(
          eq(trainingCompletions.churchId, churchId),
          eq(trainingCompletions.personId, personId)
        )
      ),
    db
      .selectDistinct({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.churchId, churchId),
          eq(teamMemberships.personId, personId),
          eq(teamMemberships.status, "active")
        )
      ),
  ]);

  if (programs.length === 0) return [];

  const completedAtByProgram = new Map(
    completions.map((c) => [c.trainingProgramId, c.completedAt])
  );
  const activeTeamIds = new Set(memberships.map((m) => m.teamId));

  const applicable = programs.filter(
    (p) =>
      p.teamId === null ||
      activeTeamIds.has(p.teamId) ||
      completedAtByProgram.has(p.id)
  );

  if (applicable.length === 0) return [];

  // Batch-load names for the teams referenced by the applicable programs.
  const teamIds = [
    ...new Set(
      applicable
        .map((p) => p.teamId)
        .filter((teamId): teamId is string => teamId !== null)
    ),
  ];

  const teamRows = teamIds.length
    ? await db
        .select({ id: ministryTeams.id, name: ministryTeams.name })
        .from(ministryTeams)
        .where(
          and(
            eq(ministryTeams.churchId, churchId),
            inArray(ministryTeams.id, teamIds)
          )
        )
    : [];

  const teamNameMap = new Map(teamRows.map((t) => [t.id, t.name]));

  return applicable.map((program) => ({
    programId: program.id,
    programName: program.name,
    teamId: program.teamId,
    teamName: program.teamId ? (teamNameMap.get(program.teamId) ?? null) : null,
    isRequired: program.isRequired,
    completedAt: completedAtByProgram.get(program.id) ?? null,
  }));
}

/**
 * Get training completion matrix for a team (members x programs)
 */
export async function getTrainingMatrix(
  churchId: string,
  teamId: string
): Promise<{ programs: TrainingProgram[]; rows: TrainingMatrixRow[] }> {
  // Get all training programs for this team (or global)
  const programs = await db
    .select()
    .from(trainingPrograms)
    .where(
      and(
        eq(trainingPrograms.churchId, churchId),
        sql`(${trainingPrograms.teamId} = ${teamId} OR ${trainingPrograms.teamId} IS NULL)`
      )
    )
    .orderBy(asc(trainingPrograms.name));

  // Get all active members
  const members = await db
    .select({
      personId: teamMemberships.personId,
    })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.status, "active")
      )
    );

  if (members.length === 0) return { programs, rows: [] };

  const memberPersonIds = members.map((m) => m.personId);

  // Batch-load person names and completions
  const [personRows, allCompletions] = await Promise.all([
    db
      .select({
        id: persons.id,
        firstName: persons.firstName,
        lastName: persons.lastName,
      })
      .from(persons)
      .where(inArray(persons.id, memberPersonIds)),
    db
      .select()
      .from(trainingCompletions)
      .where(
        and(
          eq(trainingCompletions.churchId, churchId),
          inArray(trainingCompletions.personId, memberPersonIds)
        )
      ),
  ]);

  const personNameMap = new Map(
    personRows.map((p) => [p.id, `${p.firstName} ${p.lastName}`])
  );

  // Group completions by personId
  const completionsByPerson = new Map<string, Set<string>>();
  for (const c of allCompletions) {
    const set = completionsByPerson.get(c.personId) ?? new Set();
    set.add(c.trainingProgramId);
    completionsByPerson.set(c.personId, set);
  }

  const rows: TrainingMatrixRow[] = members.map((member) => {
    const completedPrograms =
      completionsByPerson.get(member.personId) ?? new Set();
    const completionMap: Record<string, boolean> = {};
    for (const program of programs) {
      completionMap[program.id] = completedPrograms.has(program.id);
    }
    return {
      personId: member.personId,
      personName: personNameMap.get(member.personId) ?? "Unknown",
      completions: completionMap,
    };
  });

  return { programs, rows };
}
