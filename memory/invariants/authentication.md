# Authentication

Why and how, for the Authentication rules in [`../invariants.md`](../invariants.md).

**Source:** `src/lib/auth/session.ts`, `src/lib/auth/cookies.ts`, `src/lib/security/constant-time.ts`, `src/lib/crawler.ts`, `src/proxy.ts`

Sessions are server-side rather than JWT so one can be revoked immediately, and the row is keyed by the **hashed** token, so a database read never yields a usable credential.

## `"use server"` is a publishing directive

Every export of such a module compiles into a POST endpoint reachable with no session and no UI in front of it — so a helper, a read, or a "we'll wire this up later" write placed there is published to the internet. #265 removed eleven such exports, three of which detached any church from its oversight org for anyone who could guess a uuid.

Minting the actor from `verifySession()` closes the matching hole one level in: there is no parameter a forged request can name someone else in (`acceptInvitation(id, respondingUser)` used to trust the caller). Branding the actor type so only the mint can produce one turns the mistake into a compile error rather than a review note.

## Constant-time secret comparison (#266, ruled 2026-08-04)

`===` short-circuits on the first differing byte, which is a timing oracle; a plain `if (a.length !== b.length)` guard in front of `timingSafeEqual` only relocates the leak onto the secret's length. Both sides are SHA-256'd to a fixed 32 bytes first.

One `CRON_SECRET` authorises BOTH `/api/notifications/dispatch` and `/api/phase-engine/assess` (`../contracts/config.md`), which is why the comparison is shared rather than copied — hardening one route while the other keeps `===` leaks the key to both. `constant-time.test.ts` scans every route reading `CRON_SECRET` or `REVALIDATION_SECRET`.

## Request headers are client input

`src/proxy.ts` set `x-is-crawler` on the RESPONSE (`NextResponse.next()`), so to the dashboard layout reading it off the REQUEST a proxy-set value and a forged one were *indistinguishable* — which is precisely why branching on it was unsafe (#240, removed). The trustworthy channel is `NextResponse.next({ request: { headers } })`, and only when the proxy writes the header on every continuation so a client value is always overwritten.

## The crawler allowance (ruled 2026-08-04)

The previewable route list (`/dashboard`, `/wiki`, `/oversight`) is exactly the pages that render without a session, and it is spread into the proxy's `PROTECTED_ROUTE_PREFIXES` so "previewable ⊆ protected" holds structurally. Every other route bounces a crawler to `/login` like anyone else: handing the session-less shell to a page that needs a session turns a clean 307 into a 500 for anything carrying a crawler token, WhatsApp's in-app browser (a human) included.

It is a User-Agent allowance and always was — a forged UA gets the unauthenticated shell around pages that already render session-less (wiki articles, for their OG tags), never per-user data, which stays behind `getCurrentSession()` in the page.
