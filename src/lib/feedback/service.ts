import { db } from "@/db";
import {
  churches,
  feedback,
  users,
  type FeedbackCategory,
  type FeedbackStatus,
  type NewFeedback,
} from "@/db/schema";
import type { FeedbackCreateInput } from "@/lib/validations/feedback";
import { and, desc, eq } from "drizzle-orm";

// ============================================================================
// Constants
// ============================================================================

/** Default number of feedback rows returned per page in the triage view. */
export const FEEDBACK_PAGE_SIZE = 25;

// ============================================================================
// Types
// ============================================================================

export interface ListFeedbackParams {
  status?: FeedbackStatus;
  category?: FeedbackCategory;
  page?: number;
}

export interface FeedbackListItem {
  id: string;
  category: FeedbackCategory;
  description: string;
  pageUrl: string | null;
  status: FeedbackStatus;
  createdAt: Date;
  userName: string | null;
  userEmail: string;
  churchName: string | null;
}

export interface ListFeedbackResult {
  items: FeedbackListItem[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * List feedback submissions for the admin triage view.
 *
 * Newest first. Joins the submitting user (email + name) and church (name) for
 * context. Supports optional status/category filtering and is paginated with a
 * fixed page size to bound the result set.
 */
export async function listFeedback(
  params: ListFeedbackParams = {}
): Promise<ListFeedbackResult> {
  const pageSize = FEEDBACK_PAGE_SIZE;
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (params.status) {
    conditions.push(eq(feedback.status, params.status));
  }
  if (params.category) {
    conditions.push(eq(feedback.category, params.category));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch one extra row to determine whether a next page exists.
  const rows = await db
    .select({
      id: feedback.id,
      category: feedback.category,
      description: feedback.description,
      pageUrl: feedback.pageUrl,
      status: feedback.status,
      createdAt: feedback.createdAt,
      userName: users.name,
      userEmail: users.email,
      churchName: churches.name,
    })
    .from(feedback)
    .innerJoin(users, eq(feedback.userId, users.id))
    .leftJoin(churches, eq(feedback.churchId, churches.id))
    .where(where)
    .orderBy(desc(feedback.createdAt))
    .limit(pageSize + 1)
    .offset(offset);

  const hasNextPage = rows.length > pageSize;
  const items = rows.slice(0, pageSize);

  return { items, page, pageSize, hasNextPage };
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new feedback entry.
 */
export async function createFeedback(
  userId: string,
  churchId: string | null,
  input: FeedbackCreateInput
) {
  const values: NewFeedback = {
    userId,
    churchId,
    category: input.category,
    description: input.description,
    pageUrl: input.pageUrl,
  };

  const [row] = await db.insert(feedback).values(values).returning();
  return row;
}

/**
 * Update the triage status of a feedback entry.
 * Status values must be one of the schema-defined feedbackStatuses.
 */
export async function updateFeedbackStatus(id: string, status: FeedbackStatus) {
  const [row] = await db
    .update(feedback)
    .set({ status, updatedAt: new Date() })
    .where(eq(feedback.id, id))
    .returning();

  return row;
}
