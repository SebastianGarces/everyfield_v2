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
