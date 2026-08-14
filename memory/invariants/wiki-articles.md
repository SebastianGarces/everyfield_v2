# Wiki Articles

Why and how, for the Wiki Articles rules in [`../invariants.md`](../invariants.md). Two independent things: **who may see a row** (tenancy) and **how a slug becomes a path** (the two path builders are not interchangeable).

**Source:** `src/lib/wiki/get-articles.ts` (tenancy), `src/lib/wiki/get-article.ts`, `src/lib/wiki/href.ts`, `src/lib/wiki/service.ts`, `src/lib/wiki/related-sections.ts`, `src/db/schema/wiki.ts`

## Tenancy: the read is global OR mine

`wiki_articles.church_id` is nullable and means two different things — NULL is global content every plant sees, a uuid is content belonging to that one church. So the visibility predicate is a disjunction, never an equality:

```
WHERE church_id IS NULL OR church_id = :current_church_id
```

`church_id = :id` alone is wrong in the *quiet* direction: a church loses the ~90-article global corpus and sees only its own handful. There is no RLS behind these queries (`../invariants.md` → Multi-Tenancy), so this one predicate **is** the tenant boundary, and the builders are asserted through `.toSQL()` rather than by trusting the call. `visibleToChurch()` is the single implementation.

**The `churchId` default is `null`, not required.** A forgotten parameter then narrows to global only — the reader loses their own church's articles, which is visible and reportable — whereas a default that widened the read, or a "current church" resolved inside the query layer, turns a missed thread into a cross-tenant leak. Fail closed here means *under*-fetch. It is also why the thread reaches past the article routes: bookmarks, recently-viewed and last-in-progress store rows by **slug with no church on them** and re-resolve each through `getArticle`, so on the default a church's own article resolves to `null` and the surrounding `.filter(Boolean)` drops it silently.

**A church's copy of a slug overrides the global one.** `wiki_articles_slug_church_idx` is unique on `(slug, church_id)` and the predicate admits exactly two scopes, so **at most two rows** can ever match; `preferChurchOverride()` collapses them to the church's, preserving sort order. `getArticle` runs the same function over a `LIMIT 2`, so the single-article read and the lists cannot disagree about which row wins.

**`getArticles` is request-cached (`React.cache`), keyed on churchId**, because rendering one article reads the whole visible corpus at least twice with the identical query. The consequence: a mutate-then-read inside one request goes stale. Revalidate and let the next request read, rather than reaching around the cache.

**The older `service.ts` readers are not this path.** `getPublishedArticleRefs`, `getAllPublishedArticles` and `getArticlesByPhase` are hardcoded `church_id IS NULL` — global-only by design, for callers that want the shared corpus. Do not "fix" one by swapping in `eq(churchId)`, which is the mine-alone shape the invariant forbids.

## Cross-links live in the column, never in the prose

`related_article_slugs` is the ONLY place an article's cross-links live, and `RelatedArticles` resolves them against the visible corpus so a renamed, unpublished or other-church target vanishes rather than linking into a 404. The column is **derived-once**: a one-off migration lifted the links out of hand-written `## Related Articles` sections and deleted the prose, and nothing in the product writes it now. So do not re-add such a section to an article's `content` (nothing fails — it renders twice), and do not seed the column, which would overwrite real cross-links with invented ones on every `pnpm db:seed`.

**The seed wipe cannot reach the corpus either.** `pnpm db:seed` deletes users and churches unscoped and derives everything else from the FK graph, which reaches `wiki_articles` from `churches` like any other dependent. Both wiki tables are therefore `PROTECTED_TABLES`: never deleted **and never walked through**, so nothing downstream of them is dragged in. `assertProtectedTablesAreSafe()` aborts the seed *before its first DELETE* when `wiki_articles.church_id` is non-null anywhere, because the honest answer to that FK is to stop and let a human re-point the rows. Rules: [`../invariants.md`](../invariants.md) → Dev Seeds; mechanics: [`../contracts/db.md`](../contracts/db.md).

The section parser lives in `related-sections.ts` because its boundaries are the whole risk: the section ends at the end of its **link list**, not at the next heading — it is the last heading in every article, so the obvious rule deletes the closing Callout with it — and the leading `---` goes with the section.

## Slugs and paths: the two builders

`wikiHref(slug)` builds every path that will be *parsed as a URL or compared against one*. `wikiRevalidationPath(slug)` builds the argument to `revalidatePath()` — and only that.

`revalidatePath` uses its argument **verbatim as a cache tag**, and the tag a rendered page carries is derived from the *decoded* pathname with only `/ # ? %2f %23 %3f %5c` re-escaped — not from the encoded href. The two forms coincide for every URL-safe slug, which is exactly why the wrong one survives review; for a slug containing a space, `#`, `?`, `%` or a non-ASCII character, the href form matches no tag and revalidates nothing while still returning 200.

Raw interpolation breaks in the WHATWG URL parser's path state, precisely:

- `#` **ends the path** and starts the fragment; `?` ends it and starts the query. Both yield a valid URL aimed at an article that does not exist.
- `%` passes through **verbatim**, so the damage lands when Next percent-decodes the route param: `100%` throws `URIError`, `50%20off` silently decodes to `50 off`.
- A **space is in the path percent-encode set**, so the parser escapes it for us — the one character a *parsed* call site survives raw.

The rule still covers every call site, because only some are ever parsed as a URL: the sidebar's active-item check is a **literal** compare against `usePathname()`, which is already encoded, so a raw space there is a silent mismatch. Encoding is a no-op for well-formed slugs, so routing every site through `wikiHref` costs nothing and removes the judgement call at the point of use.
