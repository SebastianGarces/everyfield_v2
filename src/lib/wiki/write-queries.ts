import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  wikiBookmarks,
  wikiProgress,
  type WikiProgressStatus,
} from "@/db/schema";

// ============================================================================
// The wiki's write paths, as builders (#411)
//
// `progress.ts` and `bookmarks.ts` are `"use server"` modules — every export of
// one is a POSTable endpoint, so nothing may be exported from them just to make
// a test possible (`memory/invariants.md` → Authentication). Their statements
// therefore live here, in a sibling module with NO directive, exactly as
// `visibleArticlesQuery` and `searchArticlesQuery` do for the read paths: a
// builder can be rendered with `.toSQL()` and asserted without a database
// (`write-paths.test.ts`), which is what turns these rules into something a test
// can see rather than something a regex over the source can guess at.
//
// The rule the INSERTs carry is one line of `memory/invariants.md` →
// Transactions / Atomicity: "SELECT-then-INSERT is not a concurrency guard. Make
// duplicates impossible with a (partial) unique index, keeping that row in the
// SAME INSERT as the rows it speaks for." Both tables have that index —
// `wiki_progress_user_article_idx` and `wiki_bookmarks_user_article_idx` — so
// every insert below is ONE conflict-safe statement and never a read followed
// by a write.
//
// EVERY write means every write, DELETEs included (#411 round 2). The module and
// its test both said "every wiki write path" while the bookmark DELETEs sat
// outside in `bookmarks.ts`, so the completeness assertion enforced less than it
// claimed — and one of those deletes was the reason `toggleBookmark` still
// opened with a SELECT. `bookmarkDeleteQuery` RETURNS the rows it removed, so
// the toggle's direction comes from the write itself and the read is gone.
// ============================================================================

/** The fields a progress save may carry. Absent means "leave it alone". */
export type ProgressPatch = {
  status?: WikiProgressStatus;
  scrollPosition?: number;
};

/**
 * A progress save: one upsert keyed on (user_id, article_slug).
 *
 * The conflicting write applies exactly the fields the caller passed, which is
 * what a SELECT-then-UPDATE did before: an intermediate scroll save must not
 * rewrite `status`, and marking an article complete must not reset the scroll
 * position it was read to.
 */
export function progressUpsertQuery(
  userId: string,
  slug: string,
  patch: ProgressPatch,
  now: Date
) {
  const completedAt = patch.status === "completed" ? { completedAt: now } : {};

  return db
    .insert(wikiProgress)
    .values({
      userId,
      articleSlug: slug,
      status: patch.status ?? "in_progress",
      scrollPosition: patch.scrollPosition ?? 0,
      lastViewedAt: now,
      ...completedAt,
    })
    .onConflictDoUpdate({
      target: [wikiProgress.userId, wikiProgress.articleSlug],
      set: {
        ...patch,
        lastViewedAt: now,
        updatedAt: now,
        ...completedAt,
      },
    })
    .returning();
}

/**
 * Recording a view: the same upsert, with the no-downgrade rule IN THE
 * STATEMENT.
 *
 * "Do not move a completed article back to in_progress" used to be a JS branch
 * over a row read one statement earlier, and a stale read is not a guard: a
 * reader who finishes an article in one tab while another tab reports the view
 * — or the two requests React's development double-invoke sends — had the
 * completion overwritten, because the branch was chosen before the completion
 * landed. Observed against a real database, not reasoned about.
 *
 * The rule is now a CASE over the row Postgres is actually holding at write
 * time: inside `DO UPDATE SET`, a table-qualified column is the EXISTING row
 * (`excluded.*` would be the row being proposed), so the comparison and the
 * write are the same statement and nothing can interleave between them.
 *
 * `completed_at` and `scroll_position` are untouched on conflict — a view is
 * not a reading position, and it must not erase the moment the reader finished.
 */
export function recordViewUpsertQuery(userId: string, slug: string, now: Date) {
  return db
    .insert(wikiProgress)
    .values({
      userId,
      articleSlug: slug,
      status: "in_progress",
      scrollPosition: 0,
      lastViewedAt: now,
    })
    .onConflictDoUpdate({
      target: [wikiProgress.userId, wikiProgress.articleSlug],
      set: {
        status: sql`case when ${wikiProgress.status} = 'completed' then ${wikiProgress.status} else 'in_progress' end`,
        lastViewedAt: now,
        updatedAt: now,
      },
    })
    .returning();
}

/**
 * Adding a bookmark: one insert that tolerates the row already being there.
 *
 * Two clicks of the star in the same instant both saw no row and the second
 * INSERT died on the unique index — a thrown server action for a button the
 * reader pressed twice. A bookmark that is already there is a no-op.
 */
export function bookmarkInsertQuery(userId: string, slug: string) {
  return db
    .insert(wikiBookmarks)
    .values({
      userId,
      articleSlug: slug,
    })
    .onConflictDoNothing();
}

/**
 * Removing a bookmark: one delete, keyed the way the unique index is.
 *
 * It RETURNS the ids it removed, which is what lets `toggleBookmark` decide the
 * toggle's direction from the write instead of from a SELECT one statement
 * earlier: an empty return means there was no bookmark, so the press is an add.
 * Two presses in the same instant then resolve as delete-then-insert rather than
 * both reading "bookmarked" and both deleting.
 *
 * Keyed on (user_id, article_slug) rather than on an id read elsewhere — the
 * same pair `wiki_bookmarks_user_article_idx` is unique on, so at most one row
 * can match and the statement needs nothing to have been read first.
 */
export function bookmarkDeleteQuery(userId: string, slug: string) {
  return db
    .delete(wikiBookmarks)
    .where(
      and(eq(wikiBookmarks.userId, userId), eq(wikiBookmarks.articleSlug, slug))
    )
    .returning({ id: wikiBookmarks.id });
}
