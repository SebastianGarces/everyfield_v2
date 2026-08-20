# Authentication

Why and how, for the Authentication rules in [`../invariants.md`](../invariants.md).

**Source:** `src/lib/auth/session.ts`, `src/lib/auth/cookies.ts`, `src/lib/auth/rate-limit.ts`, `src/lib/security/constant-time.ts`, `src/lib/crawler.ts`, `src/proxy.ts`

Sessions are server-side rather than JWT so one can be revoked immediately, and the row is keyed by the **hashed** token, so a database read never yields a usable credential.

## `"use server"` is a publishing directive

Every export of such a module compiles into a POST endpoint reachable with no session and no UI in front of it — so a helper, a read, or a not-yet-wired write placed there is published to the internet.

Mint the actor from `verifySession()` inside the action rather than taking it as a parameter; there is then no argument a forged request can name someone else in.

## The guard on that surface (#498, AS-019)

Knowing the export list is the auth surface only helps if something is asked at
every one of them. Before #498 the list was 157 endpoints and two of them asked
who was calling, so a plant Member had byte-identical CRUD to the Owner.

`requireSeat(capability)` is the one guard, and the shape it has is chosen so
that adopting it is a REPLACEMENT rather than an addition: it returns exactly
what `verifySession()` returns, so a call site changes the function it already
calls and the guard is still line one, ahead of the parse. A guard that returned
`void` would have been a second statement, and a second statement is one a
reviewer can read past.

**The capability is threaded through the domain envelopes, not added beside
them.** `people/action-context.ts → withChurchSession`, `teams/action-shell.ts →
withChurch`, `launch/actions.ts → requireChurchSession` and
`notifications/actions.ts → currentViewer` each take the capability as their
FIRST argument and call the guard. Putting a `requireSeat` above the envelope
call instead would have moved the refusal outside the envelope's `try`, turning
a refusal that reads as a message into an unhandled throw — and it would have
doubled the statement count on sixty endpoints.

**The walk that enforces it is the mint walk with different roots.**
`reachingNames(file, code, roots)` is what both use: the guard has to be found
through a local helper, through an envelope one module away, and through a
re-export, which is the same three edges the mint walk already followed. A
second copy would have been a second set of blind spots.

That walk exposed a hole in its own scanner. `codeOf` stripped block comments
BEFORE line comments, so a slash-star written inside a `//` line opened a block
that ran to the next star-slash below. `launch/actions.ts` has one — a header
bullet naming `src/lib/launch/*` — and it silently deleted the file's whole
import list. Nothing failed, because the mint walk matched a literal string that
survived lower down; only a walk that must RESOLVE an import saw it. A module
could have hidden an unguarded export the same way. `codeOf` is now one
left-to-right pass over comments and string literals, and
`server-action-surface.test.ts` pins the case against the real file.


## One answer for a sessionless POST (#508)

`verifySession()` throws. Whether that throw REACHES the caller is a separate
question from whether the guard ran, and for a round it was answered six
different ways: `people/action-context.ts` and `teams/action-shell.ts` rethrew,
while launch, phase, meetings and feedback caught the same throw and returned
`{ success: false, error: "You must be logged in …" }`. Two of six followed the
rule, and the four that did not were handing an anonymous caller a well-formed
answer from an endpoint whose only correct reply is a 500 with no information.

**The condition is the shape, not the module.** A catch can only intercept the
refusal when the guard is INSIDE the `try`. `tasks/actions.ts` and
`settings/actions.ts` mint above it, so their catches never see it — that is the
stronger fix, and adopting it drops a module out of the walk entirely. Where the
guard stays inside (a domain envelope owns the `try` for sixty actions, so it
often must), the catch opens with `rethrowUnauthorized(error)`.

**It is a function, not a rule in prose,** because a rule in prose is exactly
what the four modules were breaking. `rethrowUnauthorized` is shaped like
`unstable_rethrow` — a `void` call that throws — so it reads as a statement
rather than a branch, and the classification below it never mentions
`Unauthorized` again. `server-action-surface.test.ts` walks every module under
`src/app` that is neither a client entry nor a public route group, finds each
exported function whose guard offset is greater than its `try` offset, and
asserts both halves: every catch reaches the rethrow, and no catch still
compares the message. The rethrow is found through `reachingNames`, the same
resolver the mint and guard walks use, so `launch/actions.ts` passes by
funnelling all six catches through its own `toActionError` helper instead of
copying a line six times.

## The boundary says only what it knows

The panel is `src/components/app-error.tsx`, and it is MOUNTED TWICE.
`error.tsx` wraps its segment's CHILDREN, never the layout beside it, so
`(dashboard)/error.tsx` does not cover the dashboard layout — and the sidebar's
Send Feedback button lives there. The moment `submitFeedbackAction` started
rethrowing, that press fell past the nested boundary to `global-error.tsx` and
rendered Next's bare "Application error", which is the blank page #498 added a
boundary to end. `src/app/error.tsx` is the parent segment's boundary and does
cover it; the nested one stays because it catches CLOSER and keeps the sidebar
and chrome around the message. `global-error.tsx` still sits above both, for a
throw in the ROOT layout.

It used to tell every reader their sign-in had probably expired. During #498's validation it said that about a database schema drift and
offered a Sign in button that could not have helped — a diagnosis the boundary
had no evidence for.

The evidence is a digest. A client error boundary is handed `{ message, digest }`
and nothing else, and in production Next.js replaces the message with a generic
sentence before the client sees it, so `digest` is the whole channel.
`UnauthorizedError` (`src/lib/auth/unauthorized.ts`) sets `SESSION_EXPIRED_DIGEST`
on itself, and Next.js keeps a digest an error already carries rather than
hashing a new one (`create-error-handler.js` — "respect the original digest").
`isSessionExpiry` reads it; only that case names sessions or shows Sign in.

That module is an IMPORT-FREE LEAF for the same reason `@/lib/auth/roles` is:
the client boundary imports it, and anything it imported would be pulled into
that bundle behind it.

## What this guard does NOT cover

**Route handlers.** Everything above is about `"use server"` exports, because
that is where the walk can see. `src/app/api/**` is a second surface with its
own rules ([`../contracts/api.md`](../contracts/api.md) — cron bearer auth, the
always-200 unsubscribe, the webhook signature checks), and no assertion in
`seat-guard.test.ts` reaches it. A route handler that writes feature data needs
its own `requireSeat` or `assertSeatFor` call, chosen on purpose; nothing will
tell you if you leave it out.

**A function-level directive was the third gap, and it is now closed.** An
inline `async function act() { "use server"; … }` publishes a POST endpoint just
as a module does, and `isUseServerModule` reads the PROLOGUE, so three live
writes — a meeting agenda save and the two phase-template prompt actions, one of
which creates 22–26 tasks per press — sat outside the surface the walk claims to
cover. The comment beside them said so and concluded "the rule is the authority
here, not the walk". The form is banned now (`inlineServerDirectives`), which
also makes those actions callable from a test, which an inline closure never was.

**And the capability itself is data, not a judgement.** The walk proves a guard
is called and called first; it cannot prove it was called with the right verb,
and `requireSeat("read")` on a write compiles and passes. So the mapping is
checked in (`@/lib/auth/capability-map`) and asserted with `deepEqual`: a
permission change is a one-line diff beside the endpoint, not something a
reviewer reconstructs by opening thirty action modules.

## The signed-out bounce, and why it is one function (#503)

EXACTLY TWO places send a signed-out reader to `/login`, and they cover
different populations. `src/proxy.ts` bounces `PROTECTED_ROUTE_PREFIXES` at the
edge on the presence of the session COOKIE. The `(dashboard)` layout bounces
everything else in its group — `/settings`, `/people`, `/tasks`, `/teams`,
`/meetings`, `/notifications` are in no proxy list — and it is the only bounce
at all for a cookie that exists but does not VERIFY, which the proxy cannot see.

Both name the destination, under one param, through `loginPathFor`. The layout
used to `redirect("/login")` bare, which is why a reader following a deep link
into `/settings` signed in and landed on the dashboard. The param is sanitised
on the way out as well as on the way back: `safeRedirectPath` is the read half,
so an attacker's URL never reaches the address bar of the login page either.

**Two is the whole list, and a third copy is a defect.** Three pages and the
oversight guard used to spell their own `redirect("/login")` beneath the
layout's. None carried a return path, and each could only race a bounce that
did. They are gone; those call sites take `verifySession()`, which asks for the
session the layout has already established. `session.test.ts` asserts the
oversight guard has no `/login` redirect, positively, so the copy cannot grow
back.

**The stale-cookie bounce is only terminal because `/login` is not an auth
route.** This is the loop the fix had to close, and it was live before #503:
`hasSessionCookie` is presence, not validity, so an expired session looked
signed-in to the proxy and signed-out to the layout. The layout sent that reader
to `/login`; with `/login` on `AUTH_ROUTES` the proxy sent them straight back on
the strength of the dead cookie; ERR_TOO_MANY_REDIRECTS, with the form that
would have fixed it unreachable. `AUTH_ROUTES` is now `/` and `/register` only,
and the already-signed-in bounce moved to the login PAGE, which asks
`getCurrentSession()` — a page can tell a live session from a dead one, a cookie
cannot. Putting `/login` back on that list restores the loop.

The layout learns the destination from `ROUTED_URL_HEADER` (`@/lib/routed-url`,
which owns the header and `routedPathname`, because the crawler scope and the
bounce both read it and neither is about the other). That is why the header
carries the query as well as the path: a layout is never handed `searchParams` —
`headers()` is the whole channel — so `/settings?tab=billing` would otherwise
come back as `/settings`. Fragments never make the trip at all: a browser does
not send one, so preserving `#notification-preferences` is a client-side job and
is out of scope by ruling on #503. The one place a fragment could survive is the
client: `(dashboard)/error.tsx` builds its sign-in link from `usePathname()`
through the same `loginPathFor`.

## A `"use server"` module re-exports nothing from another one (#495)

`export type { ResendInvitationEmailState } from "…/oversight/invitations/actions"` typechecks, lints and passes the whole suite, and `next build` then refuses the page with *"The export ResendInvitationEmailState was not found"*. Next's server-action transform enumerates each reachable action module's exports into the page's action manifest by NAME; a name re-exported out of another `"use server"` module is registered as an action, the type is erased before the manifest resolves, and compilation stops.

The ban is about the SOURCE module, not the keyword: `dashboard/actions.ts` re-exports three types from a directive-free module and builds fine. `server-action-surface.test.ts` resolves the specifier and fails only on the action-module case — which is also HOLE 2 of #265 (republishing somebody else's names as endpoints) with a different keyword in front of it.
