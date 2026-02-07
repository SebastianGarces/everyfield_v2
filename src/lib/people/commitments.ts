/**
 * Commitment service functions.
 * Handles CRUD operations for commitment records (Core Group / Launch Team).
 */

import { db } from "@/db";
import { commitments, type Commitment, type NewCommitment } from "@/db/schema";
import type { CommitmentCreateInput } from "@/lib/validations/people";
import { and, desc, eq } from "drizzle-orm";

// ============================================================================
// Commitment Functions
// ============================================================================

/**
 * Create a new commitment record for a person.
 * @param churchId - The church ID for scoping
 * @param userId - The user creating the commitment (for witnessedBy if not specified)
 * @param data - The commitment data
 * @param documentKey - Optional storage key for uploaded document
 */
export async function createCommitment(
  churchId: string,
  userId: string,
  data: CommitmentCreateInput,
  documentKey?: string
): Promise<Commitment> {
  const [commitment] = await db
    .insert(commitments)
    .values({
      churchId,
      personId: data.personId,
      commitmentType: data.commitmentType,
      signedDate: data.signedDate.toISOString().split("T")[0],
      witnessedBy: data.witnessedBy,
      documentUrl: documentKey, // Store the storage key, not a URL
      notes: data.notes,
    } satisfies NewCommitment)
    .returning();

  return commitment;
}

/**
 * Get all commitments for a person, ordered by date descending.
 */
export async function getCommitments(
  churchId: string,
  personId: string
): Promise<Commitment[]> {
  return db.query.commitments.findMany({
    where: and(
      eq(commitments.churchId, churchId),
      eq(commitments.personId, personId)
    ),
    orderBy: [desc(commitments.signedDate), desc(commitments.createdAt)],
  });
}

/**
 * Get the most recent commitment for a person.
 */
export async function getLatestCommitment(
  churchId: string,
  personId: string
): Promise<Commitment | undefined> {
  return db.query.commitments.findFirst({
    where: and(
      eq(commitments.churchId, churchId),
      eq(commitments.personId, personId)
    ),
    orderBy: [desc(commitments.signedDate), desc(commitments.createdAt)],
  });
}

/**
 * Get a specific commitment by ID.
 */
export async function getCommitment(
  churchId: string,
  commitmentId: string
): Promise<Commitment | undefined> {
  return db.query.commitments.findFirst({
    where: and(
      eq(commitments.churchId, churchId),
      eq(commitments.id, commitmentId)
    ),
  });
}
