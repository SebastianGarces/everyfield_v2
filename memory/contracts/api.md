# API Contracts

Routes live at `src/app/api/<route>/route.ts`; server actions in colocated `actions.ts` files
and `src/lib/<feature>/`. Read the source for signatures — the full route/action mirror this
file used to hold is in git history. What stays here is only the behavior you cannot guess
from a quick read:

## Non-obvious route behaviors

- **`POST /api/phase-engine/assess`** (Bearer `CRON_SECRET`): assessments run ONLY here or via
  the manual trigger — never as a side effect of feature code. Batched (`MAX_BATCH=10`, cut from
  25 in #36 because 25 plants cannot be paced inside the 300s function), the rest rolls over.
  Fails closed with no secret. A plant can come back **`deferred`** (`rate_limit` |
  `time_budget`) — that is NOT a failure and NOT a broken judge: the provider throttled us, or
  the run's 270s deadline arrived, so the plant keeps its last good snapshot, stays dirty and is
  re-selected next run. `deferred` is logged on `console.warn`, `failed` on `console.error`, and
  the two are counted separately in the summary (`deferred`/`rateLimited` vs `failed`). Pacing is
  header-derived (`x-ratelimit-*`), not a sleep; `PHASE_ENGINE_TPM_LIMIT` only bootstraps it.
- **`GET /api/notifications/dispatch`** (Bearer `CRON_SECRET`, every 15 min via GitHub Actions —
  Hobby caps Vercel crons at daily): claims due rows atomically; at-most-once per
  `(notification_id, channel)` unique index. Also carries the DAILY oversight digest sweep
  (N-025) — "owed" means *will produce* a digest, and the sweep can never fail the run. Full
  semantics: `product-docs/features/notifications/frd.md` + `src/lib/notifications/`.
- **`/api/notifications/unsubscribe`** (no auth — sealed token): GET half never mutates (303
  redirect; scanners/prefetch are safe). POST half is RFC 8058 one-click, CSRF-exempt in
  `src/proxy.ts`, reads everything from the token (DISABLE-only), and **always returns 200** —
  a 4xx makes mail clients retry or drop the control. Ruled 2026-08-01.
- **`POST /api/webhooks/resend`** (Svix signature): advances recipient status forward-only;
  hard bounce + complaint are prefixed `permanent: ` so retries never touch them.

Auth patterns for actions (actor from `verifySession()`, never a parameter; `"use server"`
export surface = auth surface) are invariants — see `../invariants.md` → Authentication.
