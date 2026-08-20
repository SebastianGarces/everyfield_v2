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
