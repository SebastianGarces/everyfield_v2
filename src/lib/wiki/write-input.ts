import { z } from "zod";

import { wikiProgressStatuses } from "@/db/schema";

// ============================================================================
// BOTH PARAMETERS of a wiki write, parsed (#411 rounds 6–7)
//
// `updateProgress(slug, data)` is an export of the `"use server"` module
// `progress.ts`, so BOTH arguments are request body — whatever a POST put on the
// wire — and a TypeScript parameter type constrains a forged body not at all
// (`memory/invariants.md` → Multi-Tenancy states the rule for invitations; it is
// the same rule here). Closing this took three passes, and the first two each
// closed a smaller thing than their own wording claimed:
//
//   round 5  COLUMN NAMES. `progressUpsertQuery` names its two writable columns
//            instead of spreading the object, so no OTHER COLUMN is reachable.
//   round 6  THE PATCH'S VALUES. `wiki_progress.status` is plain `text` with no
//            CHECK behind it (migration `0002_mixed_hemingway.sql`), so
//            `{ status: "certified_prophet" }` persisted verbatim into the
//            caller's own row and every reader of that column then had a fourth
//            state to meet. `progressPatchSchema` below is that parse.
//   round 7  THE SLUG — the other half of the same POST body, and the half this
//            module's own title claimed to cover while covering neither
//            `recordView` (a slug and no patch at all) nor `toggleBookmark`.
//            `wiki_progress.article_slug` and `wiki_bookmarks.article_slug` are
//            unbounded `text` with no FK and no CHECK (`src/db/schema/wiki.ts`),
//            and `progressPatchSchema` accepts `{}` — so any signed-in caller
//            could write a row of ten thousand characters under a slug that
//            addresses no article, forever, and the honest reading of "the body
//            is parsed" was "half of it is". `wikiSlugSchema` below is that
//            parse.
//
// Both schemas live here rather than in `progress.ts` for the same two reasons
// the statements live in `write-queries.ts`: a `"use server"` module may export
// nothing but endpoints, and a module with no directive can be imported by a
// test, which is what lets `write-paths.test.ts` run a hostile slug and a
// hostile body through the REAL schemas rather than assert something about the
// source text of a parse it cannot call.
// ============================================================================

/**
 * The article a wiki write may name.
 *
 * Both write tables key their rows by `article_slug` — unbounded `text`, no
 * foreign key, no CHECK (`src/db/schema/wiki.ts`) — so nothing below this line
 * bounds what a POST can store. The domain here is the one the corpus actually
 * uses and the one `encodeWikiSlug`/`wikiHref` (`href.ts`) address without
 * changing a byte: lowercase alphanumerics, `-`, `_` and `.` inside a segment,
 * `/` as the segment separator, and every segment opening on `[a-z0-9]`.
 *
 * That last clause is what makes `..` unspellable, so a traversal-shaped slug
 * is refused rather than stored; the empty string and a leading or doubled `/`
 * go with it, since none of the three addresses an article. `max(200)` is the
 * length bound the column does not have — the longest of the 96 real slugs is
 * 73 characters.
 *
 * `href.ts` documents that a STORED slug may legitimately contain a space, `#`,
 * `?` or `%`, and that is still true of the read path: the slug is authored
 * content and `encodeWikiSlug` is lossless for any of them. This schema is
 * NARROWER than that on purpose, because it governs a write rather than a read
 * — a slug outside this shape is refused, and the reader's progress on such an
 * article would silently stop saving. `tenancy-live.test.ts` runs the whole
 * stored corpus through this schema against a real database so that mismatch
 * fails a test before it reaches a reader.
 */
export const wikiSlugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/);

/**
 * The fields a progress save may carry. Absent means "leave it alone".
 *
 * `z.strictObject`, so an unknown key is a REFUSAL rather than a silently
 * ignored one: the builder names its columns, but a body carrying `userId` is a
 * caller probing for mass assignment and the honest answer is "no", not a
 * partial write it can measure.
 *
 * `scrollPosition` is a FRACTION of the article, not a pixel offset — every
 * writer computes `scrollTop / scrollableHeight` and clamps to 1
 * (`components/wiki/progress-tracker.tsx`) — so the range is the column's real
 * domain and `[0, 1]` is what the progress UI divides by.
 */
export const progressPatchSchema = z.strictObject({
  status: z.enum(wikiProgressStatuses).optional(),
  scrollPosition: z.number().min(0).max(1).optional(),
});

/** The fields a progress save may carry, derived from the schema that admits them. */
export type ProgressPatch = z.infer<typeof progressPatchSchema>;
