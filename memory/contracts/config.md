# Configuration Contracts

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Neon) |
| `NEXT_PUBLIC_APP_URL` | No | Base URL (default: localhost:3000) |
| `REVALIDATION_SECRET` | For prod | Wiki cache revalidation auth. ⚠️ Still required by `src/app/api/wiki/revalidate/route.ts` but MISSING from `.env.example` |
| `CRON_SECRET` | For prod | Cron auth (Bearer token) for BOTH scheduled routes: `/api/phase-engine/assess` and `/api/notifications/dispatch`. Both fail closed when unset |
| `OPENAI_API_KEY` | Phase Engine | LLM judge + embeddings (`src/lib/phase-engine/judge/provider.ts`, `rag/embed.ts`). Not in `.env.example` |
| `LANGFUSE_SECRET_KEY` / `_PUBLIC_KEY` / `_BASE_URL` | No | LLM tracing (`src/lib/phase-engine/observability.ts`). Not in `.env.example` |
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

Main nav and wiki nav defined in `src/lib/navigation.ts`. Features marked `isDisabled: true` are planned but not implemented. No feature flags exist.
