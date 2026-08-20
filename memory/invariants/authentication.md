# Authentication

Why and how, for the Authentication rules in [`../invariants.md`](../invariants.md).

**Source:** `src/lib/auth/session.ts`, `src/lib/auth/cookies.ts`, `src/lib/auth/rate-limit.ts`, `src/lib/security/constant-time.ts`, `src/lib/crawler.ts`, `src/proxy.ts`

Sessions are server-side rather than JWT so one can be revoked immediately, and the row is keyed by the **hashed** token, so a database read never yields a usable credential.

## `"use server"` is a publishing directive

Every export of such a module compiles into a POST endpoint reachable with no session and no UI in front of it — so a helper, a read, or a not-yet-wired write placed there is published to the internet.

Mint the actor from `verifySession()` inside the action rather than taking it as a parameter; there is then no argument a forged request can name someone else in.
