/**
 * Assessment and Interview service functions.
 * Handles CRUD operations for 4 C's assessments and member interviews.
 */

import { db } from "@/db";
import {
  assessments,
  interviews,
  type Assessment,
  type Interview,
  type NewAssessment,
  type NewInterview,
} from "@/db/schema";
import type {
  AssessmentCreateInput,
  InterviewCreateInput,
} from "@/lib/validations/people";
import { and, desc, eq } from "drizzle-orm";

// ============================================================================
// Assessment Functions (4 C's)
// ============================================================================

/**
 * Create a new 4 C's assessment for a person.
 * Calculates total score from individual scores.
 */
export async function createAssessment(
  churchId: string,
  userId: string,
  data: AssessmentCreateInput
): Promise<Assessment> {
  // Calculate total score
  const totalScore =
    data.committedScore +
    data.compelledScore +
    data.contagiousScore +
    data.courageousScore;

  const [assessment] = await db
    .insert(assessments)
    .values({
      churchId,
      personId: data.personId,
      assessedBy: userId,
      committedScore: data.committedScore,
      committedNotes: data.committedNotes,
      compelledScore: data.compelledScore,
      compelledNotes: data.compelledNotes,
      contagiousScore: data.contagiousScore,
      contagiousNotes: data.contagiousNotes,
      courageousScore: data.courageousScore,
      courageousNotes: data.courageousNotes,
      totalScore,
      assessmentDate: data.assessmentDate.toISOString().split("T")[0],
    } satisfies NewAssessment)
    .returning();

  return assessment;
}

/**
 * Get all assessments for a person, ordered by date descending.
 */
export async function getAssessments(
  churchId: string,
  personId: string
): Promise<Assessment[]> {
  return db.query.assessments.findMany({
    where: and(
      eq(assessments.churchId, churchId),
      eq(assessments.personId, personId)
    ),
    orderBy: [desc(assessments.assessmentDate), desc(assessments.createdAt)],
  });
}

/**
 * Get the most recent assessment for a person.
 */
export async function getLatestAssessment(
  churchId: string,
  personId: string
): Promise<Assessment | undefined> {
  return db.query.assessments.findFirst({
    where: and(
      eq(assessments.churchId, churchId),
      eq(assessments.personId, personId)
    ),
    orderBy: [desc(assessments.assessmentDate), desc(assessments.createdAt)],
  });
}

// ============================================================================
// Interview Functions
// ============================================================================

/**
 * Create a new interview record for a person.
 */
export async function createInterview(
  churchId: string,
  userId: string,
  data: InterviewCreateInput
): Promise<Interview> {
  const [interview] = await db
    .insert(interviews)
    .values({
      churchId,
      personId: data.personId,
      interviewedBy: userId,
      interviewDate: data.interviewDate.toISOString().split("T")[0],
      maturityStatus: data.maturityStatus,
      maturityNotes: data.maturityNotes,
      giftedStatus: data.giftedStatus,
      giftedNotes: data.giftedNotes,
      chemistryStatus: data.chemistryStatus,
      chemistryNotes: data.chemistryNotes,
      rightReasonsStatus: data.rightReasonsStatus,
      rightReasonsNotes: data.rightReasonsNotes,
      seasonStatus: data.seasonStatus,
      seasonNotes: data.seasonNotes,
      overallResult: data.overallResult,
      nextSteps: data.nextSteps,
    } satisfies NewInterview)
    .returning();

  return interview;
}

/**
 * Get all interviews for a person, ordered by date descending.
 */
export async function getInterviews(
  churchId: string,
  personId: string
): Promise<Interview[]> {
  return db.query.interviews.findMany({
    where: and(
      eq(interviews.churchId, churchId),
      eq(interviews.personId, personId)
    ),
    orderBy: [desc(interviews.interviewDate), desc(interviews.createdAt)],
  });
}

/**
 * Get the most recent interview for a person.
 */
export async function getLatestInterview(
  churchId: string,
  personId: string
): Promise<Interview | undefined> {
  return db.query.interviews.findFirst({
    where: and(
      eq(interviews.churchId, churchId),
      eq(interviews.personId, personId)
    ),
    orderBy: [desc(interviews.interviewDate), desc(interviews.createdAt)],
  });
}
