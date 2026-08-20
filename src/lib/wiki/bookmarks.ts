"use server";

// The wiki's ONE bookmark endpoint. The per-reader READS moved to `./reads`,
// which carries no directive, because `/wiki` renders for a session-less
// crawler and a read that throws there is the #297 500 all over again.

import { requireSeat } from "@/lib/auth/seats";
import { revalidatePath } from "next/cache";
import { wikiSlugSchema } from "./write-input";
import { bookmarkDeleteQuery, bookmarkInsertQuery } from "./write-queries";

/**
 * Toggle bookmark for an article
 * Returns the new bookmarked state
 *
 * The DIRECTION comes from the write, not from a read (#411): the delete runs
 * first and reports the rows it removed, so "there was a bookmark" is something
 * Postgres decided at write time. The previous shape opened with a SELECT and
 * branched on it, which meant two presses in the same instant could both read
 * "bookmarked" and both delete — the star ended up off after an even number of
 * presses that should have left it on.
 *
 * SESSION FIRST, THEN PARSE (round 7). This is an export of a `"use server"`
 * module, so `slug` is the whole POST body and the parameter type constrains a
 * forged one not at all; `wiki_bookmarks.article_slug` is unbounded `text` with
 * no FK and no CHECK behind it (`src/db/schema/wiki.ts`), so an unparsed slug is
 * an insert of whatever arrived. The refusal REJECTS rather than returning a
 * boolean, because `false` is this function's word for "the star is now off" and
 * a caller cannot be told a malformed slug that way.
 */
export async function toggleBookmark(slug: string): Promise<boolean> {
  const session = await requireSeat("self.write");

  const parsedSlug = wikiSlugSchema.safeParse(slug);
  if (!parsedSlug.success) {
    throw new Error("Unknown article");
  }

  const removed = await bookmarkDeleteQuery(session.user.id, parsedSlug.data);

  if (removed.length > 0) {
    revalidatePath("/wiki", "layout");
    return false;
  }

  // Nothing to remove, so the press adds. `bookmarkInsertQuery` tolerates the
  // row already being there, so a press that raced another press's insert is a
  // no-op rather than a unique-index violation thrown at the reader.
  await bookmarkInsertQuery(session.user.id, parsedSlug.data);
  revalidatePath("/wiki", "layout");
  return true;
}

// `addBookmark` and `removeBookmark` used to sit here — the two halves of the
// toggle above, exported separately and called by nothing. Every export of a
// `"use server"` module is a POSTable endpoint with no session cookie and no UI
// in front of it (`memory/invariants.md` → Authentication), so two dead WRITES
// were two live endpoints: post a slug, get a bookmark row. Deleted with #411,
// the same rule that emptied four dead reads out of `service.ts`.
//
// The star's one behaviour is `toggleBookmark`, whose direction comes from the
// write. A caller that genuinely needs a one-directional bookmark adds it back
// WITH that caller — `write-paths.test.ts` fails on an export of this module
// that nothing calls.
