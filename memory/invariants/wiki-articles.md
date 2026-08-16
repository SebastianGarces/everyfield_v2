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

**`getArticles` is request-cached (`React.cache`), keyed on churchId**, because rendering one article reads the whole visible corpus at least twice with the identical query. The consequence: a mutate-then-read inside one request goes stale. Revalidate and let the next request read, rather than reaching around the cache.

### A church's copy of a slug overrides the global one

`wiki_articles_slug_church_idx` is unique on `(slug, church_id)`, so a church may hold its own row for a global slug — and the visibility predicate admits exactly two scopes, so **at most two rows** can ever satisfy it. The church's published row wins; without that rule the same slug appears twice in navigation, lists and React keys.

**One implementation, and it is a predicate** (#411 round 3). `notOverriddenByChurch(churchId)` sits beside `visibleToChurch` in `get-articles.ts` and returns `NOT EXISTS (this church's published row of this slug)` — `undefined` for a churchless read, since there is nothing to override. Every reader-facing builder carries it: `visibleArticlesQuery`, `articleBySlugQuery` (which therefore takes `LIMIT 1` — the statement returns the winner, so no caller is left to choose), `searchArticlesQuery` and `publishedArticleRefsQuery`.

It replaced two parallel implementations — a JS collapse (`preferChurchOverride`) for the lists and detail read, SQL suppression for search. A JS collapse cannot answer for a RANKED read: it only sees the rows that survived the `ts_rank` cut, and the church's rewritten copy need not be among them, so the global row came back alone and the result row and the article the click opened were two different documents (reproduced in `tenancy-live.test.ts`). The SQL form is the survivor; the JS copy is deleted rather than kept in parallel.

Two terms are load-bearing. The subquery's `published` must match the read's own `status` filter, or a church drafting its own copy deletes the global article from its lists and its search while the detail route still opens it — the same disagreement in the other direction. And the church's own rows are exempt (`church_id IS NOT NULL`, which under `visibleToChurch` can only be the reader's church), or the override suppresses itself and the slug vanishes entirely.

`tenancy.test.ts` §2 pins the absence rather than the instance: it derives the wiki modules from the directory and fails if a second module declares the decision, or if a JS collapse of the pair comes back under any name.

### `service.ts` holds no article read — and no write

It held five reads, all hardcoded `church_id IS NULL`, and this file used to call them "safe but not tenant-aware". Four were dead repo-wide and were deleted rather than predicated — a barrel export of an un-predicated read is a cross-tenant read waiting for its first caller. The fifth, `getPublishedArticleRefs`, was live: the PE-024 slug index behind the insight cards, where global-only LOOKS fail-closed and was not — the card resolves a stored slug to a TITLE while the detail route answers `/wiki/<slug>` with the church's own row, so a church that overrode a slug was shown the GLOBAL title over a link that opened ITS OWN article. It lives in `get-articles.ts` now as `publishedArticleRefsQuery` + a `React.cache`d `getPublishedArticleRefs(churchId = null)`, carries `visibleToChurch` + the published filter + `notOverriddenByChurch`, and `insight-card.tsx` threads the session's churchId into it. **Every article read that ends up in front of a reader lives in `get-articles.ts`, carries the pair, and is in `readerFacingReads()`.**

The same rule then reached the mutations: eleven caller-less DB exports — three carrying the very defects removed one screen above (`updateArticle`/`updateSection` spread a caller-supplied `Partial<New…>` over every column including `church_id` and `status`; `createArticle` inserted whatever `churchId` the caller passed, untenanted) — plus two dead revalidation wrappers were deleted rather than predicated, because predicating dead code doubles the tenancy surface a reviewer must hold. `service.ts` is now `wikiRevalidationPath` + `revalidateArticle` and the research comment justifying them; `service.test.ts` pins the PROPERTY, not the eleven names — no `@/db` specifier, no `db.<verb>(` statement, exactly those two exports, and no export `functionBodies` cannot read. ⚠ `revalidateArticle` itself has no in-app caller today; the tokened route handler builds the path with `wikiRevalidationPath` directly.

### The reader-facing list counts itself

`readerFacingReads()` (`tenancy.test.ts`) drives three loops — the override predicate, the churchless case, the published filter — and its docblock said "every" while recording that "every" had been untrue twice. It is now `deepEqual`'d against every `*Query` export of the two module namespaces, read at runtime off `import * as`; a second test asserts a `*Query` builder is DECLARED only in `get-articles.ts`, `search.ts` and `write-queries.ts`, and it reads BOTH spellings of a declaration — `export function` AND `export const …Query`, through `valueExportStatements`, proven by adding the escaping file and watching the guard name it.

## Cross-links live in the column, never in the prose

`related_article_slugs` is the ONLY place an article's cross-links live, and `RelatedArticles` resolves them against the visible corpus so a renamed, unpublished or other-church target vanishes rather than linking into a 404. The column is **derived-once**: a one-off migration lifted the links out of hand-written `## Related Articles` sections and deleted the prose, and nothing in the product writes it now. So do not re-add such a section to an article's `content` (nothing fails — it renders twice), and do not seed the column, which would overwrite real cross-links with invented ones on every `pnpm db:seed`.

**The seed wipe cannot reach the corpus either.** `pnpm db:seed` deletes users and churches unscoped and derives everything else from the FK graph, which reaches `wiki_articles` from `churches` like any other dependent. Both wiki tables are therefore `PROTECTED_TABLES`: never deleted **and never walked through**, so nothing downstream of them is dragged in. `assertProtectedTablesAreSafe()` aborts the seed *before its first DELETE* when `wiki_articles.church_id` is non-null anywhere, because the honest answer to that FK is to stop and let a human re-point the rows. Rules: [`../invariants.md`](../invariants.md) → Dev Seeds; mechanics: [`../contracts/db.md`](../contracts/db.md).

The section parser lives in `related-sections.ts` because its boundaries are the whole risk: the section ends at the end of its **link list**, not at the next heading — it is the last heading in every article, so the obvious rule deletes the closing Callout with it — and the leading `---` goes with the section.

## Search refuses by rejecting, so the caller owns the outcome

`searchWikiArticles` mints with `verifySession()` above everything else — `src/proxy.ts` redirects unauthenticated callers only on `GET`, so a POST to that `"use server"` export arrives with no session cookie — and the refusal is a **thrown** `Unauthorized`, deliberately: an empty array would be indistinguishable from "no article matches those words". The dialog once awaited that promise bare inside an async `setTimeout`: an unhandled rejection, and a spinner that never settled because every state transition sat below the `await`.

The handling belongs at the CALL, not in the action's return type — a dropped connection, a 500 and a stale action id all reject too, and a server action rejection reaches the browser as an opaque digest. `runWikiSearch(search, query)` (`src/lib/wiki/search-request.ts`) turns every request into `{status:"results"}` or `{status:"unavailable"}` (rendered as `SEARCH_UNAVAILABLE_MESSAGE`); "No articles found." is reserved for a search that actually ran. The module takes the search function as an argument so the refusal path runs in a unit test, and it is deliberately NOT re-exported from the wiki barrel — a `"use client"` dialog imports it, and the barrel reaches `@/db`.

**"Could not answer" has ONE shape, and it is a rejection.** The action's own `catch` used to `return []` — a second decision site that converted every server-side read failure (a dropped Neon connection, a statement timeout, a Postgres error out of `websearch_to_tsquery`) into "No articles found." about a search that never ran, leaving `unavailable` reachable only from an expired session or a transport failure. The catch stays — it holds the only server-side log, and `tenancy.test.ts` pins the mint above the `try` — but it RETHROWS. Pinned by ABSENCE on the source (`search-request.test.ts` §2: no `return []` inside a `catch`), because the suite injects its own throwing `search` and never exercises the real one.

**The dialog holds the union.** Four independent `useState` flags left four legal combinations out of sixteen, five render guards each repeating every earlier guard's negation, and "unavailable implies no results" maintained by hand at one call site. It is ONE state now — `view: {kind:"idle"|"searching"|"unavailable"} | {kind:"results"; rows}` — four mutually exclusive arms, and settling a request is ONE `setView`, so no outcome can leave the spinner up.

**One live region, because a mounted-per-arm region announces nothing.** A live region is announced only when text changes inside a region the AT was already observing; the arms are mutually exclusive, so `role="status"` on the arms detached and re-mounted on every transition — and the results arm carried none, leaving the dialog with no region at all once rows rendered (measured on the preview). It is ONE region now, mounted for the life of `Command` and placed BESIDE the listbox — not inside `CommandList`, because cmdk gives it `role="listbox"` and a listbox may own only options and groups, so a status child is an `aria-required-children` violation the AT may prune. Its text is `announcementFor(view)`, exhaustive over the union; the arms are purely presentational. `search-request.test.ts` counts exactly one region inside `Command`, none inside `CommandList`.

## Writes: named columns, parsed values, parsed slug

`progress.ts` and `bookmarks.ts` are `"use server"` modules, so every export is a public POST endpoint and its parameters are request body — a TypeScript parameter type constrains a forged body not at all (`../invariants.md` → Multi-Tenancy states this rule for invitations; same rule here).

**Named columns.** `progressUpsertQuery` spread the caller's patch into its `onConflictDoUpdate` SET, so `{userId: "<victim>"}` rendered `do update set "user_id" = $6` — the row's OWNER, and any column of `wiki_progress` was reachable the same way. The SET is built field by field now, from the two fields the caller is entitled to set (`status`, `scrollPosition`), which makes every other COLUMN unreachable by construction while keeping "the write applies exactly the fields the caller passed". `write-paths.test.ts` renders the hostile patch and asserts the SET names neither `user_id` nor `article_slug`. The `write-queries.ts` seam made it findable: a statement with no directive can be `.toSQL()`-rendered, so what is asserted is what reaches the database.

**Parsed values.** Naming the columns says nothing about the VALUES: `wiki_progress.status` is bare `text` with no CHECK, so a forged `{status:"certified_prophet"}` persisted into the caller's own row and every reader of the column met a fourth state. `updateProgress` parses `progressPatchSchema` — `z.strictObject` over `status` (the schema's own list) and `scrollPosition` (`[0,1]`, a fraction, not pixels) — directly below its session mint (mint, then parse) and passes only `parsed.data` on. Strict, so an unknown key is a refusal: a body carrying `userId` is a probe, and a probe should not be able to tell a partial write from a rejection. The schema lives in `write-input.ts`, a directive-free sibling, for the same reasons the statements live in `write-queries.ts`: a `"use server"` module may export nothing but endpoints, and a module a test can import is one a hostile body runs through for real.

**Parsed slug — the other half of the same POST.** `wiki_progress.article_slug` and `wiki_bookmarks.article_slug` are unbounded `text` with no FK and no CHECK, and `progressPatchSchema` accepts `{}`, so the patch parse alone stopped nothing: a signed-in caller could key a ten-thousand-character junk row on a name addressing no article. ALL THREE endpoints now parse `wikiSlugSchema` below the mint — `updateProgress`, `recordView` (a slug and no body at all), and `toggleBookmark`, which REJECTS because `false` is its word for "the star is now off". The schema is `min(1).max(200)` plus a per-segment shape opening on `[a-z0-9]`, which makes `..`, the empty string, a leading `/` and a doubled `/` unspellable. ⚠ Deliberately NARROWER than what `encodeWikiSlug` can address (`href.ts`: a stored slug may legitimately hold a space, `#`, `?`, `%`) — the cost of a slug outside it is a reader whose progress silently stops saving, which is why `tenancy-live.test.ts` runs the whole STORED corpus through the schema against a real database, and `write-paths.test.ts` runs the hostile slugs through it and pins each builder to `parsedSlug.data` rather than the raw parameter.

### Article feedback is church-scoped, one vote per reader

`wiki_article_feedback` is the fourth wiki write table, and unlike progress and bookmarks it carries `church_id` as part of the key. A vote is a plant's signal about an article — two churches rating the same global slug are two independent rows — so the unique index is `(church_id, user_id, article_slug)` and every read of a vote names `church_id` in the WHERE. The church is minted from the session inside `submitArticleFeedbackAction`; it is not an argument a POST can name. Changing a vote is `ON CONFLICT DO UPDATE` against that index, so a second press cannot insert a duplicate. The SET names `rating` and `updated_at` only.

The slug is the same `wikiSlugSchema` the other writes parse, and the rating is a closed pair (`helpful` / `unhelpful`) with a CHECK behind it, because `.$type<>()` on a varchar is a compile-time brand and nothing else.

**An endpoint with no caller is deleted.** Four exports survived the sweep that emptied `service.ts` — `getArticleProgress`, `markCompleted`, `addBookmark`, `removeBookmark` — and three were live WRITES nobody was reviewing, kept only because they read like obvious companions to functions that are used. `write-paths.test.ts` derives both modules' export lists and fails on any export no non-test file in `src/` names; the barrel's `export *` moves a name rather than calling it, and a test asserting an endpoint exists is not a caller either.

**The list is only as complete as the parser.** `functionBodies` matches `function` declarations only, so `export const markCompleted = async (slug) => {…}` is an equally POSTable endpoint the walk cannot see — and the `assert.ok(endpoints.length > 0)` tripwire can never fire for it, since both modules keep readable declarations forever. `valueExportStatements(code)` — the shared reader for the forms the walk cannot read (value binding, default export, re-export) — is asserted EMPTY for both modules before the caller loop runs, on purpose duplicating `server-action-surface.test.ts`: this file's guarantee must not depend on another suite's scope.

## Slugs and paths: the two builders

`wikiHref(slug)` builds every path that will be *parsed as a URL or compared against one*. `wikiRevalidationPath(slug)` builds the argument to `revalidatePath()` — and only that.

`revalidatePath` uses its argument **verbatim as a cache tag**, and the tag a rendered page carries is derived from the *decoded* pathname with only `/ # ? %2f %23 %3f %5c` re-escaped — not from the encoded href. The two forms coincide for every URL-safe slug, which is exactly why the wrong one survives review; for a slug containing a space, `#`, `?`, `%` or a non-ASCII character, the href form matches no tag and revalidates nothing while still returning 200.

Raw interpolation breaks in the WHATWG URL parser's path state, precisely:

- `#` **ends the path** and starts the fragment; `?` ends it and starts the query. Both yield a valid URL aimed at an article that does not exist.
- `%` passes through **verbatim**, so the damage lands when Next percent-decodes the route param: `100%` throws `URIError`, `50%20off` silently decodes to `50 off`.
- A **space is in the path percent-encode set**, so the parser escapes it for us — the one character a *parsed* call site survives raw.

The rule still covers every call site, because only some are ever parsed as a URL: the sidebar's active-item check is a **literal** compare against `usePathname()`, which is already encoded, so a raw space there is a silent mismatch. Encoding is a no-op for well-formed slugs, so routing every site through `wikiHref` costs nothing and removes the judgement call at the point of use.
