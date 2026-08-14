import { z } from "zod";

import { wikiProgressStatuses } from "@/db/schema";

// ============================================================================
// What a wiki write is allowed to ARRIVE as (#411 round 6)
//
// `updateProgress(slug, data)` is an export of the `"use server"` module
// `progress.ts`, so `data` is a request body — whatever a POST put on the wire —
// and a TypeScript parameter type constrains a forged body not at all
// (`memory/invariants.md` → Multi-Tenancy states the rule for invitations; it is
// the same rule here). Round 5 closed half of that: `progressUpsertQuery` names
// its two writable columns instead of spreading the object, so no OTHER COLUMN
// is reachable. It left the VALUES unguarded — `wiki_progress.status` is a plain
// `text` column with no CHECK behind it (migration `0002_mixed_hemingway.sql`),
// so `{ status: "certified_prophet" }` persisted verbatim into the caller's own
// row and every reader of that column then had a fourth state to meet.
//
// So the patch is PARSED before it reaches the builder, and the schema lives
// here rather than in `progress.ts` for the same two reasons the statements live
// in `write-queries.ts`: a `"use server"` module may export nothing but
// endpoints, and a module with no directive can be imported by a test, which is
// what lets `write-paths.test.ts` run a hostile body through the real schema
// rather than assert something about the source text of a parse it cannot call.
// ============================================================================

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
