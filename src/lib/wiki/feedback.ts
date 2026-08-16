import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  wikiArticleFeedback,
  wikiArticleFeedbackRatings,
  type WikiArticleFeedback,
  type WikiArticleFeedbackRating,
} from "@/db/schema";

import { wikiSlugSchema } from "./write-input";
import { articleFeedbackUpsertQuery } from "./write-queries";

// ============================================================================
// Article feedback (W-016)
//
// Per-article helpful / unhelpful rating. One current vote per
// (church, user, article); upserted on wiki_article_feedback_church_user_article_idx.
//
// Every operation is church_id-scoped: the church is an argument the action
// minted from the session, never a field the POST may name. A vote written for
// one plant is invisible to every other, because both the write and the read
// name church_id in the statement.
// ============================================================================

export const submitArticleFeedbackSchema = z.strictObject({
  articleSlug: wikiSlugSchema,
  rating: z.enum(wikiArticleFeedbackRatings),
});

export type SubmitArticleFeedbackInput = z.infer<
  typeof submitArticleFeedbackSchema
>;

export interface UpsertArticleFeedbackInput {
  articleSlug: string;
  rating: WikiArticleFeedbackRating;
}

/**
 * The read a reload uses to restore the control: this user's vote on this
 * article, in this church, or nothing.
 *
 * church_id is in the WHERE, not inferred from the user row. A user who moved
 * plants must not see the vote they cast in the last one, and a query that
 * dropped the church would return another plant's row for the same user+slug.
 */
export function articleFeedbackForUserRead(
  churchId: string,
  userId: string,
  articleSlug: string
) {
  return db
    .select()
    .from(wikiArticleFeedback)
    .where(
      and(
        eq(wikiArticleFeedback.churchId, churchId),
        eq(wikiArticleFeedback.userId, userId),
        eq(wikiArticleFeedback.articleSlug, articleSlug)
      )
    )
    .limit(1);
}

export async function getArticleFeedbackForUser(
  churchId: string,
  userId: string,
  articleSlug: string
): Promise<WikiArticleFeedback | null> {
  const [feedback] = await articleFeedbackForUserRead(
    churchId,
    userId,
    articleSlug
  );
  return feedback ?? null;
}

/**
 * Upsert a user's vote for an article, scoped to a church.
 *
 * Unique per (church, user, article): a second call from the same reader
 * updates the existing rating rather than inserting a duplicate. The statement
 * itself is `articleFeedbackUpsertQuery` in `write-queries.ts`.
 */
export async function upsertArticleFeedback(
  churchId: string,
  userId: string,
  input: UpsertArticleFeedbackInput
): Promise<WikiArticleFeedback> {
  const [feedback] = await articleFeedbackUpsertQuery(
    churchId,
    userId,
    input.articleSlug,
    input.rating,
    new Date()
  );

  if (!feedback) {
    throw new Error("Failed to save feedback");
  }

  return feedback;
}
