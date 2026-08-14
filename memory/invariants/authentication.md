# Authentication

Why and how, for the Authentication rules in [`../invariants.md`](../invariants.md).

**Source:** `src/lib/auth/session.ts`, `src/lib/auth/cookies.ts`, `src/lib/auth/rate-limit.ts`, `src/lib/security/constant-time.ts`, `src/lib/crawler.ts`, `src/proxy.ts`

Sessions are server-side rather than JWT so one can be revoked immediately, and the row is keyed by the **hashed** token, so a database read never yields a usable credential.

## `"use server"` is a publishing directive

Every export of such a module compiles into a POST endpoint reachable with no session and no UI in front of it — so a helper, a read, or a not-yet-wired write placed there is published to the internet.

Mint the actor from `verifySession()` inside the action rather than taking it as a parameter; there is then no argument a forged request can name someone else in. The actor type is branded so only the mint can produce one, which turns the mistake into a compile error rather than a review note.

## Constant-time secret comparison

`===` short-circuits on the first differing byte, which is a timing oracle, and a plain length guard in front of `timingSafeEqual` only relocates the leak onto the secret's length. Both sides are SHA-256'd to a fixed 32 bytes first.

One `CRON_SECRET` authorises BOTH `/api/notifications/dispatch` and `/api/phase-engine/assess` (`../contracts/config.md`), which is why the comparison is shared rather than copied — hardening one route while the other keeps `===` leaks the key to both.

## Request headers are client input

A header the proxy sets on the RESPONSE (`NextResponse.next()`) is indistinguishable, to a page reading it off the REQUEST, from one a client forged. The trustworthy channel is `NextResponse.next({ request: { headers } })`, and only when the proxy writes the header on every continuation so a client value is always overwritten.

The same rule decides how a client IP is read for rate limiting. The FIRST hop of `x-forwarded-for` is the segment the client itself sends, so an attacker rotates a forged first hop and every per-IP limit evaporates. `getRequestIp` (`src/lib/auth/rate-limit.ts`) reads the platform-written `x-real-ip` first and falls back to the LAST hop of `x-forwarded-for` — the hop appended nearest our proxy, which the client cannot write.

## The crawler allowance

The previewable route list is `/wiki` and nothing else. What earns a prefix a place there is one claim in two parts: **the route produces a session-less render worth previewing.** It must render with no session — a link previewer has nothing else to give it — and that render must be the page rather than a redirect, because admitting a crawler to a route that bounces it anyway produces no card and only widens the unauthenticated surface.

The two prefixes that were removed are those two halves in worked form. `/dashboard` calls `verifySession()`, which throws, so every crawler-UA request to it 500'd. `/oversight` renders session-less and then `redirect("/login")` — never a 500, but the crawler ends at the login page and no OG card is ever produced.

Both stay in `PROTECTED_ROUTE_PREFIXES`, **named explicitly rather than reached by the spread of the previewable list**. While the protected list was a bare spread of the previewable one, removing a prefix from the previewable list unprotected the route as a silent side effect.

WhatsApp sends two User-Agents and only one is a bot. The link-preview fetcher's UA *is* the token (`WhatsApp/2.23.20.0`, `WhatsApp/2.24.15.78 A`); the in-app browser is a person who tapped a shared link, behind an ordinary `Mozilla/5.0 …` UA that also mentions WhatsApp. A bare substring matches both, so the token is anchored to the start of the UA (`^whatsapp/<digit>`) — the version-slash alone appears in both and does not separate them. An unrecognised WhatsApp build therefore fails closed as a human: a missing preview card, never a broken page.

It is a User-Agent allowance and always was — a forged UA gets the unauthenticated shell around pages that already render session-less (wiki articles, for their OG tags), never per-user data, which stays behind `getCurrentSession()` in the page.
