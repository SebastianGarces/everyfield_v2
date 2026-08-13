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

`wiki_articles_slug_church_idx` is unique on `(slug, church_id)`, so a church may hold its own row for a global slug — and the visibility predicate admits exactly two scopes, so **at most two rows** can ever satisfy it. The church's published row wins; without that rule the same slug appears twice in navigation, lists and React keys.

**One implementation, and it is a predicate** (#411 round 3). `notOverriddenByChurch(churchId)` sits beside `visibleToChurch` in `get-articles.ts` and returns `NOT EXISTS (this church's published row of this slug)` — `undefined` for a churchless read, since there is nothing to override. Every reader-facing builder carries it: `visibleArticlesQuery`, `articleBySlugQuery` (which therefore takes `LIMIT 1` — the statement returns the winner, so no caller is left to choose) and `searchArticlesQuery`.

It used to have two implementations, and that is the part worth keeping. The lists and the single-article read collapsed the `(slug, church_id)` pair in JS afterwards (`preferChurchOverride`), which works only because they read the **whole** visible corpus; search suppressed the global row inside the statement. A JS collapse cannot answer for a **ranked** read at all: it only ever sees the rows that survived the `ts_rank` cut, and the church's copy need not be among them — a rewritten copy may not match the tsquery, or may rank below the cut — so the global row came back alone with nothing to collapse it against, and the result row and the article the click opened were two different documents. Reproduced against a real database (`tenancy-live.test.ts`), not reasoned about. So the SQL form is the survivor and the JS copy is deleted rather than kept in parallel; a SQL builder and a JS predicate could never share an *implementation*, and here they could not even share the *decision*.

Two terms are load-bearing. The subquery's `published` must match the read's own `status` filter, or a church drafting its own copy deletes the global article from its lists and its search while the detail route still opens it — the same disagreement in the other direction. And the church's own rows are exempt (`church_id IS NOT NULL`, which under `visibleToChurch` can only be the reader's church), or the override suppresses itself and the slug vanishes entirely.

`tenancy.test.ts` §2 pins the absence rather than the instance: it derives the wiki modules from the directory and fails if a second module declares the decision, or if a JS collapse of the pair comes back under any name.

### `getArticles` is request-cached, keyed on churchId

`getArticles` is wrapped in `React.cache`. Rendering one article reads the whole visible corpus at least twice (sidebar navigation in the wiki layout, `getArticleNavigation` in the page) and every read is the identical query, so the memo is what keeps derived affordances free. The consequence: **a mutate-then-read inside one request goes stale** — write an article and re-read within the same request and you get the pre-write corpus. Revalidate and let the next request read (see `wikiRevalidationPath` below), rather than reaching around the cache. Outside a React request scope (the test runner) `cache` calls straight through, so live fixtures set up between reads are seen.

### The older `service.ts` readers are not this path

`getPublishedArticleRefs`, `getAllPublishedArticles` and `getArticlesByPhase` are hardcoded `church_id IS NULL` — global-only by design, for callers (PE-024 insight links, admin) that want the shared corpus. They are safe but they are **not** tenant-aware; do not "fix" one by swapping in `eq(churchId)`, which is the mine-alone shape the invariant forbids. Reader-facing article access goes through `get-articles.ts` / `get-article.ts`.

## Cross-links: the column is canonical, the prose is gone (#317)

`related_article_slugs` is the ONLY place an article's cross-links live. `RelatedArticles` renders them at the foot of the page, resolved against the visible corpus so a renamed, unpublished or other-church target vanishes rather than rendering a link into a 404.

That was not true when the column was added. Every one of the 96 articles ended with a hand-written section — `---`, `## Related Articles`, a bullet list of `/wiki/...` links, `---`, a closing `<Callout>` — so the derived component showed the reader the same list a second time. The ruling was that the component is canonical: `scripts/migrate-wiki-related-sections.ts` lifted all 358 links into the column and deleted the prose, in one pass over the shared dev database.

So the column is **derived-once**, not authored and not maintained: it was written from prose by that migration and nothing in the product writes it now. Two consequences:

- **Do not re-add a `## Related Articles` section to an article's `content`.** Nothing fails — it renders, twice, under two headings. Add the slug to the column instead.
- **Do not seed the column.** `seed-dev-db.ts` used to write a hardcoded fixture (including deliberately dead slugs, to prove they get dropped); that block is gone, because a fixture now overwrites an article's real cross-links with invented ones on every `pnpm db:seed`. `get-articles.test.ts` §4 asserts the seed stays out.
- **The wipe cannot reach the corpus either (#326).** `pnpm db:seed` deletes all users and all churches unscoped and derives everything else from the FK graph — which reaches `wiki_articles` from `churches` like any other dependent. `wiki_articles` and `wiki_sections` are therefore `PROTECTED_TABLES` in `seed-dev-db.ts`: never deleted **and never walked through**, so nothing downstream of them is dragged in either. And a church-scoped article is not an obstacle to route around — `assertProtectedTablesAreSafe()` aborts the whole seed *before its first DELETE* when `wiki_articles.church_id` is non-null anywhere, because the honest answer to that FK is to stop and let a human re-point the rows, not to delete content the migration alone can produce. Rules: [`../invariants.md`](../invariants.md) → Dev Seeds; mechanics: [`../contracts/db.md`](../contracts/db.md).

The parser lives in `src/lib/wiki/related-sections.ts` rather than in the script, because its boundaries are the whole risk and needed unit tests: the section ends at the end of its **link list**, not at the next heading — it is the last heading in every article, so the obvious rule would have deleted the closing Callout with it — and the leading `---` goes with the section, or the two surviving rules end up adjacent. A list item that is not a plain markdown link aborts that article instead of half-stripping it.

## Search refuses by rejecting, so the caller owns the outcome (#411)

`searchWikiArticles` mints an actor with `verifySession()` above everything else — `src/proxy.ts` only redirects unauthenticated callers on `GET`, so a POST to that `"use server"` export reaches it with no session cookie and no UI in front of it. The refusal is therefore a **thrown** `Unauthorized`, deliberately: an empty array would be indistinguishable from "no article matches those words".

The dialog awaited that promise bare, inside an async `setTimeout` callback. Two failures at once: an unhandled promise rejection, and a `Searching…` spinner that never settled — `setIsSearching(false)` sits *below* the `await`, so a rejection skipped every state transition and left the reader watching a spinner with no way to learn the search had refused.

The fix is at the call, not in the action's return type. A second return shape would not have closed it: a dropped connection, a 500 out of the action and a deploy that invalidated the action id all reject too, and a server action rejection reaches the browser as an opaque digest, so the dialog cannot tell them apart anyway. `runWikiSearch(search, query)` (`src/lib/wiki/search-request.ts`) turns every request into `{ status: "results" }` or `{ status: "unavailable" }`, and the dialog renders the second as `SEARCH_UNAVAILABLE_MESSAGE` — "Reload the page and try again", because reloading is what returns an expired session to `/login`. "No articles found." stays reserved for a search that actually ran.

The module takes the search function as an argument so the refusal path runs in a unit test (`search-request.test.ts`) rather than only in a browser, and it is deliberately **not** re-exported from `src/lib/wiki/index.ts` — a `"use client"` dialog imports it, and the barrel reaches `@/db` through every other wiki module.

### The action had a second decision site, and it was the likelier one (round 4)

Round 3 wrote the sentence above while the action's own `catch` still did this:

```ts
} catch (error) {
  console.error("Wiki search error:", error);
  return [];          // ← a failed read, told to the reader as "No articles found."
}
```

Only the `verifySession()` throw sat above that `try`. Everything the READ can fail on — a dropped Neon connection, a statement timeout, a Postgres error out of `websearch_to_tsquery`/`ts_rank` — was converted into an empty array, which `runWikiSearch` then classified `{status:"results", results: []}`. So `{status:"unavailable"}`, the branch the whole change exists to produce, was reachable only from an expired session or a browser transport failure — never from the server-side failure that is by far the most likely cause of a search not answering. Two decision sites for one question ("what is the reader told when search cannot answer"), which is the same duplication this workstream collapsed for the church-override rule one section up.

The catch stays: it holds the only server-side log with the real error, and `tenancy.test.ts` asserts the mint precedes a `try`. It **rethrows**. The action now has exactly one shape for "could not answer", and it is a rejection.

Pinned by ABSENCE, on the source: `search-request.test.ts` §2 asserts the action's module contains no `return []` inside a `catch`. It cannot be pinned by running the action — that module reaches `@/db` — and the suite's own tests inject a throwing `search`, so they exercise `runWikiSearch`'s catch and never the action's.

### The dialog holds the union (round 4)

`WikiSearchOutcome` models the answer correctly. The dialog then threw that modelling away: four independent `useState` flags — `results`, `isSearching`, `hasSearched`, `isUnavailable` — of which only four of the sixteen combinations were legal, so five render guards had to re-establish mutual exclusion by hand, each repeating every earlier guard's negation. The results guard was the tell: it alone omitted `!isUnavailable`, and it was correct only because `setResults([])` and `setIsUnavailable(true)` happened to sit in the same React batch. "unavailable implies no results" was an invariant maintained by hand at exactly one call site.

It is one state now:

```ts
type View =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "unavailable" }
  | { kind: "results"; rows: SearchResult[] };
```

Four mutually exclusive arms, no guard repeating another's negation, and settling a request is ONE `setView` — so neither outcome can leave the spinner up, and "No articles found." is a property of the `"results"` arm rather than a negation a future guard has to remember. The round-3 tests reached for source-text regexes (`/!isSearching &&\s+isUnavailable/`, and a span between two literal strings) to assert what is now a type-level fact; what remains on the source is the arm shape and the one-assignment settle.

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
