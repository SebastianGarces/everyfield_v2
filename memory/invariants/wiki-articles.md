# Wiki Articles

Why and how, for the Wiki Articles rules in [`../invariants.md`](../invariants.md). Two independent things: **who may see a row** (tenancy, below) and **how a slug becomes a path** (the two path builders are not interchangeable).

**Source:** `src/lib/wiki/get-articles.ts` (tenancy), `src/lib/wiki/get-article.ts`, `src/lib/wiki/href.ts`, `src/lib/wiki/service.ts`, `src/lib/wiki/search.ts`, `src/db/schema/wiki.ts`

## Tenancy: the read is global OR mine (#317, from #16)

`wiki_articles.church_id` is nullable and means two different things — NULL is global content every plant sees, a uuid is content belonging to that one church. So the visibility predicate is a disjunction, never an equality:

```
WHERE church_id IS NULL OR church_id = :current_church_id
```

`church_id = :id` alone is wrong in the *quiet* direction: a church would lose the ~90-article global corpus and see only its own handful. There is no RLS behind these queries (`../invariants.md` → Multi-Tenancy), so this one predicate **is** the tenant boundary — which is why `tenancy.test.ts` renders each builder with `.toSQL()` and asserts the emitted SQL rather than trusting the call. `visibleToChurch()` is the single implementation; every list, the single-article read, prev/next and related articles all funnel through it.

### Why the `churchId` default is `null`, not required

Every reader — `getArticles`, `getArticlesByPrefix`, `getWikiNavigation`, `getArticleNavigation`, `getArticle` — takes `churchId: string | null = null`. A forgotten parameter therefore narrows to **global only**: the reader loses their own church's articles, which is visible and reportable. The alternative defaults all fail dangerously — an omitted argument that widened the read, or a non-null "current church" resolved inside the query layer, turns a missed thread into a cross-tenant leak. Fail closed here means *under*-fetch.

That default is also why threading `churchId` reached further than the article routes. `getBookmarks`, `getRecentlyViewed` and `getLastInProgress` (`bookmarks.ts`, `progress.ts`) store rows by **slug with no church on them** and re-resolve each slug through `getArticle`. Left on the default they resolved a church's own article to `null`, and the surrounding `.filter(Boolean)` dropped it — a bookmarked article silently vanishing from the sidebar rather than erroring.

### A church's copy of a slug overrides the global one

`wiki_articles_slug_church_idx` is unique on `(slug, church_id)`, so a church may hold its own row for a global slug — and the predicate admits exactly two scopes, so **at most two rows** can ever match. `preferChurchOverride()` collapses them to the church's, preserving sort order. Without it the same slug appears twice in navigation, lists and React keys. `getArticle` runs the same function over a `LIMIT 2` so the single-article read and the lists cannot disagree about which row wins.

### `getArticles` is request-cached, keyed on churchId

`getArticles` is wrapped in `React.cache`. Rendering one article reads the whole visible corpus at least twice (sidebar navigation in the wiki layout, `getArticleNavigation` in the page) and every read is the identical query, so the memo is what keeps derived affordances free. The consequence: **a mutate-then-read inside one request goes stale** — write an article and re-read within the same request and you get the pre-write corpus. Revalidate and let the next request read (see `wikiRevalidationPath` below), rather than reaching around the cache. Outside a React request scope (the test runner) `cache` calls straight through, so live fixtures set up between reads are seen.

### The older `service.ts` readers are not this path

`getPublishedArticleRefs`, `getAllPublishedArticles` and `getArticlesByPhase` are hardcoded `church_id IS NULL` — global-only by design, for callers (PE-024 insight links, admin) that want the shared corpus. They are safe but they are **not** tenant-aware; do not "fix" one by swapping in `eq(churchId)`, which is the mine-alone shape the invariant forbids. Reader-facing article access goes through `get-articles.ts` / `get-article.ts`.

## Slugs and paths: the two builders

`wikiHref(slug)` builds every path that will be *parsed as a URL or compared against one*. `wikiRevalidationPath(slug)` builds the argument to `revalidatePath()` — and only that.

### Why `revalidatePath` is different (#310)

`revalidatePath` uses its argument **verbatim as a cache tag**, and the tag a rendered page carries is derived from the *decoded* pathname with only `/ # ? %2f %23 %3f %5c` re-escaped — not from the encoded href. The two forms coincide for every URL-safe slug, which is exactly why the wrong one survived review. For a slug containing a space, `#`, `?`, `%` or a non-ASCII character, the href form matched no tag and revalidated nothing while still returning 200. `service.test.ts` pins the form against Next's own `decodePathParams` and scans the source so `revalidatePath(wikiHref(` cannot come back.

### Why raw interpolation breaks (precisely)

The earlier claim that "a space breaks the link outright" was wrong. In the WHATWG URL parser's path state:

- `#` **ends the path** and starts the fragment; `?` ends it and starts the query. Both yield a valid URL aimed at an article that does not exist.
- `%` passes through **verbatim**, so the damage lands when Next percent-decodes the route param: `100%` throws `URIError`, `50%20off` silently decodes to `50 off`.
- A **space is in the path percent-encode set**, so the parser escapes it for us — the one character a *parsed* call site survives raw.

The rule still covers every call site, because only some are ever parsed as a URL. The sidebar's active-item check is a **literal** compare against `usePathname()`, which is already encoded — there a raw space is a silent mismatch: no highlighted item, no error. Since encoding is a no-op for well-formed slugs, routing every site through `wikiHref` costs nothing and removes the judgement call at the point of use.
