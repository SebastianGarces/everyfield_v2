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

**One implementation, and it is a predicate** (#411 round 3). `notOverriddenByChurch(churchId)` sits beside `visibleToChurch` in `get-articles.ts` and returns `NOT EXISTS (this church's published row of this slug)` — `undefined` for a churchless read, since there is nothing to override. Every reader-facing builder carries it: `visibleArticlesQuery`, `articleBySlugQuery` (which therefore takes `LIMIT 1` — the statement returns the winner, so no caller is left to choose), `searchArticlesQuery` and `publishedArticleRefsQuery`.

It used to have two implementations, and that is the part worth keeping. The lists and the single-article read collapsed the `(slug, church_id)` pair in JS afterwards (`preferChurchOverride`), which works only because they read the **whole** visible corpus; search suppressed the global row inside the statement. A JS collapse cannot answer for a **ranked** read at all: it only ever sees the rows that survived the `ts_rank` cut, and the church's copy need not be among them — a rewritten copy may not match the tsquery, or may rank below the cut — so the global row came back alone with nothing to collapse it against, and the result row and the article the click opened were two different documents. Reproduced against a real database (`tenancy-live.test.ts`), not reasoned about. So the SQL form is the survivor and the JS copy is deleted rather than kept in parallel; a SQL builder and a JS predicate could never share an *implementation*, and here they could not even share the *decision*.

Two terms are load-bearing. The subquery's `published` must match the read's own `status` filter, or a church drafting its own copy deletes the global article from its lists and its search while the detail route still opens it — the same disagreement in the other direction. And the church's own rows are exempt (`church_id IS NOT NULL`, which under `visibleToChurch` can only be the reader's church), or the override suppresses itself and the slug vanishes entirely.

`tenancy.test.ts` §2 pins the absence rather than the instance: it derives the wiki modules from the directory and fails if a second module declares the decision, or if a JS collapse of the pair comes back under any name.

### `getArticles` is request-cached, keyed on churchId

`getArticles` is wrapped in `React.cache`. Rendering one article reads the whole visible corpus at least twice (sidebar navigation in the wiki layout, `getArticleNavigation` in the page) and every read is the identical query, so the memo is what keeps derived affordances free. The consequence: **a mutate-then-read inside one request goes stale** — write an article and re-read within the same request and you get the pre-write corpus. Revalidate and let the next request read (see `wikiRevalidationPath` below), rather than reaching around the cache. Outside a React request scope (the test runner) `cache` calls straight through, so live fixtures set up between reads are seen.

### `service.ts` holds no article read at all any more (#411 rounds 5–6)

It used to hold five, all hardcoded `church_id IS NULL`, and this file used to call them "safe but not tenant-aware". That reading was wrong about the one with a caller.

Four — `getArticleBySlug`, `getAllPublishedArticles`, `getArticlesBySection`, `getArticlesByPhase` — were dead repo-wide and were deleted rather than predicated (round 5), because a barrel export of an un-predicated read is a cross-tenant read waiting for its first caller.

The fifth, `getPublishedArticleRefs`, was live: the PE-024 slug index behind the insight cards. Global-only **looks** like the fail-closed default the rest of the wiki uses, and here it was not, because this read is not the read that answers the click. The card resolves a stored slug to a **title** and links to `/wiki/<slug>`; the detail route resolves that path through `articleBySlugQuery`, which answers with the church's own row when it has one. So for a church that overrode a global slug the card advertised the GLOBAL title over a link that opened the CHURCH's article — the same two-documents mismatch search had, one component over, and the failure mode #411 exists to close. Under-fetching is only harmless where the under-fetched thing is all the caller does.

It lives in `get-articles.ts` now as `publishedArticleRefsQuery` + a `React.cache`d `getPublishedArticleRefs(churchId = null)`, carries `visibleToChurch` + the published filter + `notOverriddenByChurch`, and `insight-card.tsx` threads `session.user.churchId` into it. Two tests own it: `readerFacingReads()` in `tenancy.test.ts` (which is why that loop's name — EVERY reader-facing read — is now true), and a seeded case in `tenancy-live.test.ts` that asserts both directions against a real database, one church's private rows never reaching another reader, and every title in the index resolving to the article its own link opens.

**So the rule is now general: every article read in `src/lib/wiki/` that ends up in front of a reader lives in `get-articles.ts`, carries the pair, and is in `readerFacingReads()`.**

### …and then the same rule reached the mutations it was written above (quality round 1)

Rounds 5–6 emptied the reads out of `service.ts` and left thirteen exports below the deletion with no caller anywhere in the repo: eleven DB functions (`createArticle`, `updateArticle`, `archiveArticle`, `deleteArticle`, `getAllSections`, `getSectionBySlug`, `getChildSections`, `getRootSections`, `createSection`, `updateSection`, `deleteSection`) and two revalidation wrappers (`revalidateWikiIndex`, `revalidateAllWiki`). The rule the reads died under was stated in the file that kept them, and `index.ts` does `export * from "./service"`, so `@/lib/wiki` handed every one of them to the next caller.

Three carried precisely the defects this workstream had spent rounds removing one screen above:

- `updateArticle` and `updateSection` did `.set({ ...data, updatedAt: new Date() })` over a caller-supplied `Partial<New…>` — the mass-assignment shape round 5 removed from `progressUpsertQuery`, reachable here for **every** column, `church_id` and `status` included.
- `createArticle` inserted a `NewWikiArticle` whose `churchId` was whatever the caller passed: no session, no tenancy predicate, in a domain whose invariant says the application layer *is* the boundary.

None of the three is POST-reachable — `service.ts` carries no `"use server"` directive — which is why this was structural and not critical. They are deleted rather than predicated, for the reason the four dead reads were: nothing wanted them, and predicating dead code doubles the tenancy surface a reviewer has to hold. An admin write surface will bring its own, session-scoped, with the church stamped from the actor rather than taken as an argument.

**`service.ts` is now the `revalidatePath` form and the one wrapper that applies it**, plus the Next research comment that justifies both. That is pinned as a property rather than as a list of eleven forbidden names: `service.test.ts` asserts the module names no `@/db` specifier (via the shared `staticValueSpecifiers`, not a hand-rolled `^import` regex), builds no `db.<verb>(` statement, exports exactly `wikiRevalidationPath` and `revalidateArticle`, and publishes no export `functionBodies` cannot read. A module with no database edge cannot regrow an un-predicated read or an untenanted write, whatever the next one is called.

⚠ `revalidateArticle` itself has no in-app caller today — the tokened route handler (`src/app/api/wiki/revalidate/route.ts`) builds the path with `wikiRevalidationPath` and injects its own `revalidatePath` so the handler stays testable. It is kept deliberately, and it is not the shape the deletions above are about: it reaches no database, has no tenancy surface, wraps `next/cache` only, and `service.test.ts` pins its body character for character as the sanctioned in-app spelling — which is what stops the href form being handed to `revalidatePath` again.

### The reader-facing list counts itself now (quality round 1)

`readerFacingReads()` in `tenancy.test.ts` drives three loops — the override predicate, the churchless case, the published filter — and its docblock recorded that "every" had been untrue twice without doing anything about it. Nothing mechanical stopped a third time.

It is keyed on the builders' own names now, and `deepEqual`'d against `READER_FACING_QUERY_EXPORTS`: every export ending in `Query` from the two module namespaces, read at runtime off `import * as`. The suffix is the seam — a statement builder ends in `Query` throughout this domain and the readers built on them (`getArticles`, `getWikiNavigation`) do not — so adding `visibleDraftsQuery` to `get-articles.ts` and forgetting the list fails `pnpm test` with a message that names the omission. A second test closes the other half: a `*Query` builder may be **declared** only in `get-articles.ts`, `search.ts` and `write-queries.ts` (whose builders `write-paths.test.ts` owns), so a fifth read arriving in a third module cannot sit outside both suites. This is the mechanism `write-paths.test.ts` already used for the writes — `satisfies Record<keyof typeof writeQueries, …>` plus a runtime key comparison — applied to reads that span two modules and therefore cannot use `keyof typeof`.

**And that second test reads BOTH spellings of a declaration** (quality round 1, review round 2). Its first cut scanned `export function …Query` only — a `function` DECLARATION — so `export const visibleDraftsQuery = (churchId) => db.select()…` in a new `src/lib/wiki/drafts.ts` matched nothing: outside `READER_FACING_QUERY_EXPORTS` (which reads the `get-articles.ts` and `search.ts` namespaces only), outside all three tenancy loops, and outside the very guard written to catch a third module, with the whole suite green. That is the same blind spot the SAME commit had just closed one level down in `write-paths.test.ts` and `service.test.ts`, and with the repo's shared reader: `declaresQueryBuilder(code)` in `tenancy.test.ts` now counts a module as declaring when the function regex matches **or** when `valueExportStatements(code)` — `@/lib/auth/server-action-surface`, the one reader for the forms a declaration scan cannot see — holds a statement matching `/^export\s+(?:const|let|var)\s+\w+Query\b/`. Proven by adding that file: `pnpm test` fails the guard with `drafts.ts` in the actual array (20/20 green before the widening, 19/20 after). A guard whose own reader is narrower than the syntax is a guard that reports a coverage it does not have — widen the reader, never the list of instances.

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

### One live region, because a mounted-per-arm region announces nothing (round 5)

Holding the union fixed the render and left one thing half-done: the round-4 dialog put `role="status"` on three of the arms themselves. A live region is announced only when text changes **inside a region the assistive technology was already observing**; the arms are mutually exclusive, so every transition detached one region and mounted another — a mount, never an update — and the results arm carried no region at all, which left the dialog with no live region whatsoever once rows rendered. Proven on the preview: `sameNodeBeforeDuring: false` across the idle→searching transition, and `[role="status"]` counting 0 with no other `aria-live` anywhere in the dialog once results landed.

So the message the whole round-3/4 chain exists to produce — "Search is unavailable" — could never be announced to a screen-reader user. The fix is the same reframing one level down: **one region, mounted for the life of `Command` and placed BESIDE the listbox, whose TEXT is a function of `view`** (`announcementFor`, exhaustive over the union), and the list arms are purely presentational. It sits inside `Command` rather than inside `CommandList` because cmdk renders `CommandList` with `role="listbox"` (`node_modules/cmdk/dist/index.mjs`, `List` → `role:"listbox"`), and a listbox may own only options and groups — a `role="status"` child is an axe `aria-required-children` violation and is liable to be pruned by the very AT the region exists to reach. `Command` and `CommandList` mount and unmount together, so nothing about the region's permanence changes. What varies with the state is the sentence, not whether a region exists. `search-request.test.ts` counts `role="status"` inside `Command` (exactly one), asserts NONE appears inside `CommandList`, asserts that region's body names no `view.kind`, and asserts it renders `announcementFor(view)`.

## Writes: named columns only, because the patch is a POST body (#411 round 5)

`progress.ts` and `bookmarks.ts` are `"use server"` modules, so `updateProgress(slug, data)` is a public POST endpoint and `data` is whatever the request body held — a TypeScript parameter type constrains a forged body not at all (`../invariants.md` → Multi-Tenancy states this rule for invitations; it is the same rule here).

`progressUpsertQuery` spread that object into its `onConflictDoUpdate` SET:

```ts
set: { ...patch, lastViewedAt: now, updatedAt: now, ...completedAt }
```

Rendered with a hostile patch, that is mass assignment, not a hypothetical one:

```
progressUpsertQuery("<me>", "discovery/values", { userId: "<victim>" }, now).toSQL()
→ … on conflict ("user_id","article_slug") do update set "user_id" = $6, … 
  params: [ …, "<victim>", … ]
```

`user_id` is the row's owner. Any column of `wiki_progress` was reachable the same way. The SET is now built field by field from the two the caller is entitled to set:

```ts
const changes = {
  ...(patch.status !== undefined && { status: patch.status }),
  ...(patch.scrollPosition !== undefined && { scrollPosition: patch.scrollPosition }),
};
```

Which keeps the original property — "the conflicting write applies exactly the fields the caller passed", so a scroll save does not rewrite `status` — while making every other **column** unreachable by construction rather than by what a caller happens to send. `write-paths.test.ts` renders a patch carrying `userId` and `articleSlug` and asserts the DO UPDATE SET contains neither column. The seam is what made this findable at all: the statement lives in `write-queries.ts` with no directive, so `.toSQL()` shows what would reach the database.

### Naming the columns was half of it — the body is parsed too (round 6)

The paragraph above claimed "every other column unreachable by construction", and that sentence was true of the COLUMN NAMES and silent about the VALUES bound to the two columns that remain. `wiki_progress.status` is a plain `text` column with no CHECK behind it (migration `0002_mixed_hemingway.sql`), so `updateProgress(slug, {status: "certified_prophet"})` — one POST, no session cookie needed to reach the endpoint, and a TypeScript parameter that constrains nothing — persisted verbatim into the caller's own row, and every reader that switches on that column then met a fourth state nobody wrote a branch for.

So the PATCH is parsed before it reaches the builder, in the order `memory/invariants.md` → Authentication requires: mint, then parse.

```ts
const parsed = progressPatchSchema.safeParse(data);
if (!parsed.success) return null;
```

`progressPatchSchema` is a `z.strictObject` over `status` (the schema's own `wikiProgressStatuses`) and `scrollPosition` (`[0,1]`, the fraction the progress UI divides by — not a pixel offset). Strict, so an unknown key is a refusal rather than a silently dropped field: the builder already makes that column unreachable, and a body carrying `userId` is a probe, which should not be able to tell a partial write from a rejection.

It lives in `write-input.ts`, a THIRD directive-free sibling, for the two reasons the statements live in `write-queries.ts`: a `"use server"` module may export nothing but endpoints, and a module a test can import is a module a hostile body can be run through for real — `write-paths.test.ts` parses the forged values themselves, then reads `updateProgress`'s body with `functionBodies` to pin that the parse sits between the mint and the builder and that `parsed.data` is what the builder gets.

### …and the SLUG is the other half of the same POST (round 7)

The round above closed `data` and left `slug`, and then wrote a sentence — "the body is parsed" — that covered both. It did not. `slug` reached `wiki_progress.article_slug` and `wiki_bookmarks.article_slug` unparsed on all three write endpoints, and both columns are unbounded `text` with **no foreign key and no CHECK** (`src/db/schema/wiki.ts`). `progressPatchSchema` accepts `{}`, so the patch parse alone stopped nothing: any signed-in caller could `updateProgress("<ten thousand characters>", {})` — or `recordView`, which takes a slug and no body at all, or `toggleBookmark` — and leave junk rows keyed on names that address no article. The exposure is mild (the rows are the caller's own); the CLAIM was the defect, which is the same overstatement one level out that the round above exists to correct.

**Both parameters are now parsed, on all three endpoints**, below the mint and above the builder:

```ts
const parsedSlug = wikiSlugSchema.safeParse(slug);
if (!parsedSlug.success) return null;         // `throw` in toggleBookmark
```

`wikiSlugSchema` (`write-input.ts`) is `min(1).max(200)` plus `/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/` — every segment opens on `[a-z0-9]`, which is what makes `..`, the empty string, a leading `/` and a doubled `/` unspellable. `toggleBookmark` REJECTS instead of returning, because `false` is its word for "the star is now off".

⚠ It is deliberately **narrower than the read path**. `href.ts` documents that a stored slug may legitimately contain a space, `#`, `?` or `%`, and `encodeWikiSlug` still addresses all four — but a slug outside `wikiSlugSchema` is refused at the WRITE, and the reader's progress on such an article would then silently never save. That is why the domain is asserted against real rows rather than in prose: `tenancy-live.test.ts` runs the whole stored corpus through `wikiSlugSchema` (96 articles, longest slug 73 characters, all inside it) so a drifting corpus fails a test before it costs a reader their scroll position. `write-paths.test.ts` runs the hostile slugs — empty, ten thousand characters, `../../etc` — through the real schema, and pins each endpoint's builder to `parsedSlug.data` rather than to the raw parameter, since the two render identically and only the source tells them apart.

### An endpoint with no caller is deleted (round 6)

Four exports survived the sweep that emptied four dead reads out of `service.ts`, in the two modules where the rule bites hardest: `getArticleProgress` and `markCompleted` (`progress.ts`), `addBookmark` and `removeBookmark` (`bookmarks.ts`). Every export of a `"use server"` module is a POSTable endpoint with no session cookie and no UI in front of it, so three of those four were live WRITES nobody was reviewing — post a slug and mark it complete, or bookmark it — kept only because they read like the obvious companions to functions that are used.

`write-paths.test.ts` derives both modules' export lists with `functionBodies` and fails on any export that no non-test file in `src/` names. Two exclusions carry the meaning: the wiki barrel (`index.ts`) re-exports these modules, and a re-export moves a name rather than calling it; and a test that merely asserts the endpoint exists is not a caller either — that is precisely the shape the guard is for.

#### The list is only as complete as the parser (quality round 1)

`functionBodies` matches `function` **declarations** only (`server-action-surface.ts` says so in its own header), so `export const markCompleted = async (slug: string) => {…}` is an equally POSTable endpoint that the walk cannot see and the caller check therefore never runs against. The test anticipated that in its own words and guarded it with `assert.ok(endpoints.length > 0)` — which cannot fire for the case it was written for, because both modules keep several readable declarations forever. A dead arrow-function endpoint would have sat reachable behind a green suite: the exact regression the guard exists to make impossible, arriving through a syntax the guard does not read.

The parser is now proved to have seen the whole export surface before its list is trusted: `valueExportStatements(code)` — the repo's shared reader for the three forms the walk cannot read (a value binding, a default export, a re-export) — is asserted **empty** for both modules before the caller loop runs. It is the same reader `server-action-surface.test.ts` bans those forms repo-wide with, asserted here as well on purpose: this file's guarantee must not depend on another suite's scope, which is the failure mode `memory/invariants.md` records for the leaf guards.

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
