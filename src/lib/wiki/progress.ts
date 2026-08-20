"use server";

// The wiki's TWO progress endpoints. The per-reader READS moved to `./reads`,
// which carries no directive, because `/wiki` renders for a session-less
// crawler and a read that throws there is the #297 500 all over again.

import { requireSeat } from "@/lib/auth/seats";
import { revalidatePath } from "next/cache";
import {
  progressPatchSchema,
  wikiSlugSchema,
  type ProgressPatch,
} from "./write-input";
import { progressUpsertQuery, recordViewUpsertQuery } from "./write-queries";

// `getArticleProgress` used to live here, and `markCompleted` at the foot of the
// file. Both were dead repo-wide, and both were exports of THIS module — so each
// was a POST endpoint reachable with no session cookie and no UI in front of it
// (`memory/invariants.md` → Authentication: the export list IS the auth
// surface). `markCompleted` was the worse of the two: an unreferenced WRITE that
// marked any slug complete for whoever posted it. Deleted with #411 for the same
// reason the four dead reads left `service.ts` — nothing wanted them, and an
// endpoint kept "in case" is an endpoint nobody is reviewing.
//
// A caller that needs either one writes it back with a caller attached;
// `write-paths.test.ts` fails the moment an export of this module has none.

/**
 * Update progress for an article (upsert).
 *
 * ONE statement, not a read followed by a write — the statement itself is
 * `progressUpsertQuery` in `write-queries.ts`, which is where every wiki write
 * path is built and where the reason is written down.
 *
 * SESSION FIRST, THEN PARSE (`memory/invariants.md` → Authentication). BOTH
 * parameters are request body: this is an export of a `"use server"` module, so
 * a POST reaches it with whatever shapes it likes and the parameter types stop
 * none of it. The builder names the two columns it will write, which is what
 * makes every OTHER column unreachable; the two parses are what make the VALUES
 * legal ones, because `wiki_progress.status` is plain `text` with no CHECK
 * behind it and `article_slug` is unbounded `text` with no FK behind it. Neither
 * half may be skipped: `progressPatchSchema` accepts `{}`, so an unparsed slug
 * alone is enough to write an unbounded junk row under a name that addresses no
 * article. An argument that fails either schema is refused entirely rather than
 * written in part — `null`, the same answer a sessionless caller gets, since
 * both are shapes only a bug or a probe produces.
 */
export async function updateProgress(slug: string, data: ProgressPatch) {
  const session = await requireSeat("self.write");

  const parsedSlug = wikiSlugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  const parsed = progressPatchSchema.safeParse(data);
  if (!parsed.success) return null;

  const [saved] = await progressUpsertQuery(
    session.user.id,
    parsedSlug.data,
    parsed.data,
    new Date()
  );

  return saved ?? null;
}

/**
 * Record a view (sets to in_progress unless the reader already finished it).
 *
 * The "don't downgrade a completed article" rule travels INSIDE the statement
 * (`recordViewUpsertQuery`), not in a branch over a row read a moment earlier:
 * a completion that landed between the read and the write was overwritten, so
 * finishing an article in one tab while another reported the view reset it to
 * in_progress (#411).
 *
 * Its slug is parsed for the reason `updateProgress`'s is (round 7): this
 * endpoint takes a slug and NO body at all, so the slug is the entire POST and
 * an unparsed one is an unbounded row keyed on a name that addresses nothing.
 */
export async function recordView(slug: string) {
  const session = await requireSeat("self.write");

  const parsedSlug = wikiSlugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  const [saved] = await recordViewUpsertQuery(
    session.user.id,
    parsedSlug.data,
    new Date()
  );

  // Revalidate wiki layout to update "Recently Viewed" sidebar
  revalidatePath("/wiki", "layout");

  return saved ?? null;
}
