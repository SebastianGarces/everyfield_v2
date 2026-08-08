# Wiki Articles

Why and how, for the Wiki Articles rules in [`../invariants.md`](../invariants.md). Nearly all of it is one thing: a slug is authored content, and the two path-building functions are not interchangeable.

**Source:** `src/lib/wiki/href.ts`, `src/lib/wiki/service.ts`, `src/lib/wiki/search.ts`, `src/db/schema/wiki.ts`

`wikiHref(slug)` builds every path that will be *parsed as a URL or compared against one*. `wikiRevalidationPath(slug)` builds the argument to `revalidatePath()` — and only that.

## Why `revalidatePath` is different (#310)

`revalidatePath` uses its argument **verbatim as a cache tag**, and the tag a rendered page carries is derived from the *decoded* pathname with only `/ # ? %2f %23 %3f %5c` re-escaped — not from the encoded href. The two forms coincide for every URL-safe slug, which is exactly why the wrong one survived review. For a slug containing a space, `#`, `?`, `%` or a non-ASCII character, the href form matched no tag and revalidated nothing while still returning 200. `service.test.ts` pins the form against Next's own `decodePathParams` and scans the source so `revalidatePath(wikiHref(` cannot come back.

## Why raw interpolation breaks (precisely)

The earlier claim that "a space breaks the link outright" was wrong. In the WHATWG URL parser's path state:

- `#` **ends the path** and starts the fragment; `?` ends it and starts the query. Both yield a valid URL aimed at an article that does not exist.
- `%` passes through **verbatim**, so the damage lands when Next percent-decodes the route param: `100%` throws `URIError`, `50%20off` silently decodes to `50 off`.
- A **space is in the path percent-encode set**, so the parser escapes it for us — the one character a *parsed* call site survives raw.

The rule still covers every call site, because only some are ever parsed as a URL. The sidebar's active-item check is a **literal** compare against `usePathname()`, which is already encoded — there a raw space is a silent mismatch: no highlighted item, no error. Since encoding is a no-op for well-formed slugs, routing every site through `wikiHref` costs nothing and removes the judgement call at the point of use.
