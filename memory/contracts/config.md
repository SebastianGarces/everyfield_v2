# Configuration Contracts

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Neon) |
| `NEXT_PUBLIC_APP_URL` | No | Base URL (default: localhost:3000) |
| `REVALIDATION_SECRET` | For prod | Wiki cache revalidation auth. ⚠️ Still required by `src/app/api/wiki/revalidate/route.ts` but MISSING from `.env.example` |
| `CRON_SECRET` | For prod | Cron auth (Bearer token) for BOTH scheduled routes: `/api/phase-engine/assess` and `/api/notifications/dispatch`. Both fail closed when unset. Lives in TWO places that must hold the same value: the Vercel production env (read by the routes) and this repo's Actions secrets (sent by BOTH schedules — `.github/workflows/notifications-dispatch.yml` every 15 min, `.github/workflows/phase-engine-assess.yml` at 07:00/19:00 UTC). Since #36 `vercel.json` carries no crons at all: Hobby caps Vercel crons at daily, which is too few for either job |
| `OPENAI_API_KEY` | Phase Engine | LLM judge + embeddings (`src/lib/phase-engine/judge/provider.ts`, `rag/embed.ts`). Not in `.env.example` |
| `PHASE_ENGINE_TPM_LIMIT` | No | Bootstrap tokens-per-minute ceiling the assessment batch paces against (`src/lib/phase-engine/judge/token-pacer.ts`, default 30000). It only covers the window between an OpenAI tier upgrade and the first response of the next run — `x-ratelimit-limit-tokens` on any response OVERRIDES it, so it is a hint, never the authority. A non-numeric or non-positive value falls back to the default rather than throwing (#36) |
| `LANGFUSE_SECRET_KEY` / `_PUBLIC_KEY` / `_BASE_URL` | No | LLM tracing (`src/lib/phase-engine/observability.ts`). Not in `.env.example` |
| `UNSUBSCRIBE_TOKEN_SECRET` | For notification email | Seals BOTH AES-256-GCM capability tokens (`src/lib/notifications/channels/unsubscribe-token.ts`): the emailed `disable` link (180d) and the confirmation page's `enable` undo (1h). The key is `SHA-256(purpose : secret)`, so the two directions — and `CRON_SECRET`, the accepted fallback — never share a key. With NEITHER variable set, composing a notification email FAILS rather than sending a dead opt-out link |
| `RESEND_API_KEY` | For email | Resend client (`src/lib/email/client.ts`, webhook route) |
| `RESEND_WEBHOOK_SECRET` | Email tracking | Svix signature check in `src/app/api/webhooks/resend/route.ts` |
| `EMAIL_FROM` | For email | Outbound from address |
| `FEEDBACK_EMAIL_TO` | No | Feedback notification recipient (`feedback/actions.ts`). Not in `.env.example` |
| `AWS_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_ENDPOINT_URL_S3` / `_REGION` / `_BUCKET_NAME` | File storage | Tigris (S3-compatible) — commitment documents etc. |
| `ADMIN_EMAILS` | Admin UI | Comma-separated platform-admin allowlist (`src/lib/auth/admin.ts`) |
| `BETA_INVITE_CODE` | No | Private-beta register gate; unset = gate off (`register/actions.ts`). Not in `.env.example` |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | No | Error tracking (server/client); unset = no-op |
| `SENTRY_ORG` / `_PROJECT` / `_AUTH_TOKEN` | No | Build-time source-map upload (`next.config.ts`) |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Local only | Preview deployment-protection bypass (`scripts/preview-url.sh --bypass`) |

**Source:** `.env.example` + `grep process.env` across `src/`

---

## Constants

**Session** (`src/lib/auth/session.ts`): SESSION_EXPIRY_DAYS 30 · SESSION_REFRESH_THRESHOLD_DAYS 15 · FRESH_SESSION_MINUTES 10 · SESSION_COOKIE_NAME "session" (`src/lib/auth/cookies.ts`)

**Password hashing — Argon2id** (`src/lib/auth/password.ts`): memoryCost 19456 KiB · timeCost 2 · outputLen 32 · parallelism 1

---

## Cookie Settings

- `session` — httpOnly, secure in prod, sameSite lax. Source: `src/lib/auth/cookies.ts`
- `sidebar_state` — non-httpOnly UI state. Source: `src/components/ui/sidebar.tsx` (shadcn sidebar)

---

## Navigation Config

All four nav lists live in `src/lib/navigation.ts`. There are no feature flags — an unbuilt feature is handled by the nav list itself, and the two nav families handle it by DIFFERENT rules. `src/lib/navigation.test.ts` pins both.

| List | Unbuilt feature | Page-exists guard |
|------|-----------------|-------------------|
| `mainNavItems` (church roles) | MAY stay visible as `isDisabled: true` — `nav-main.tsx` renders it inert (`pointer-events-none`) with a COMING SOON label | Every item WITHOUT that flag must have a `page.tsx` behind its href (#272) |
| `sendingChurchNavItems`, `networkAdminNavItems` (oversight) | The exception: a disabled row is FORBIDDEN — the item is deleted from the list until its `page.tsx` lands, and comes back in the same change that adds the page (#260). The test asserts zero `isDisabled` entries in these two lists | Every item, no exemptions |
| `wikiNavSections` | `isDisabled: true` marks unwritten articles | Not guarded — these hrefs are served by the catch-all `/wiki/[...slug]`, and the App Router walker skips dynamic segments by design |

Why oversight is stricter: an oversight admin sees ONLY that sidebar, so a greyed or dead row leaves them no way back. A planter has the rest of the app.
