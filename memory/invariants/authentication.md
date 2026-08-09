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

## The crawler allowance (ruled 2026-08-04, tightened by #297, narrowed 2026-08-09)

The previewable route list is `/wiki` and nothing else. What earns a prefix a place there is one claim in two parts, ruled 2026-08-09 on PR #354: **the route produces a session-less render worth previewing.** It must render with no session — a link previewer has nothing else to give it — and that render must be the page rather than a redirect, because admitting a crawler to a route that bounces it anyway produces no card and only widens the unauthenticated surface. Every other route bounces a crawler to `/login` like anyone else.

Two prefixes have been removed, one for each half of that claim, and together they are the contract in worked form:

- **`/dashboard` (#297)** failed "renders with no session". The page calls `verifySession()`, which throws — so the listing made a promise the page could not keep and every crawler-UA request to it 500'd.
- **`/oversight` (2026-08-09)** failed "worth previewing". Its pages do render session-less, then read the session and `redirect("/login")` — graceful, never a 500, but the crawler ends at the login page and no OG card is ever produced.

Both stay in `PROTECTED_ROUTE_PREFIXES`, **named explicitly rather than reached by the spread of the previewable list**. That is load-bearing rather than stylistic: the protected list was once a bare spread of the previewable one, so removing a prefix from the previewable list would have unprotected the route as a silent side effect. `proxy.test.ts` retypes both prefixes when it asserts "every previewable route is protected", which is what pins that they cannot slip out together.

WhatsApp sends two User-Agents and only one is a bot. The link-preview fetcher's UA *is* the token (`WhatsApp/2.23.20.0`, `WhatsApp/2.24.15.78 A`); the in-app browser is a person who tapped a shared link, behind an ordinary `Mozilla/5.0 …` UA that also mentions WhatsApp. The bare substring matched both, so the token is anchored to the start of the UA (`^whatsapp/<digit>`) — the version-slash alone appears in both and does not separate them. An unrecognised WhatsApp build therefore fails closed as a human: a missing preview card, never a broken page.

It is a User-Agent allowance and always was — a forged UA gets the unauthenticated shell around pages that already render session-less (wiki articles, for their OG tags), never per-user data, which stays behind `getCurrentSession()` in the page.
