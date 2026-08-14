# API Contracts

Routes live at `src/app/api/<route>/route.ts`; server actions in colocated `actions.ts` files
and `src/lib/<feature>/`. Read the source for signatures — the full route/action mirror this
file used to hold is in git history. What stays here is only the behavior you cannot guess
from a quick read:

## Non-obvious route behaviors

- **`GET /api/phase-engine/assess`** (Bearer `CRON_SECRET`, twice daily at 07:00/19:00 UTC via
  GitHub Actions; `vercel.json` declares NO crons, so re-adding one gives this route two drivers
  racing the same TPM window). Assessments run ONLY here or from the manual trigger — never as a
  side effect of feature code. Fails closed with no secret.
  - Batched (`MAX_BATCH=10` — 25 plants cannot be paced inside the 300s function), the rest
    rolls over. Selection is **oldest-assessed-first, never-assessed ahead of everything**:
    the cap drops the tail, so without that order the same tail starves every tick.
  - A plant can come back **`deferred`** (`rate_limit` | `time_budget`). That is NOT a failure
    and NOT a broken judge — the provider throttled us, or the run's 270s deadline arrived, so
    the plant keeps its last good snapshot, stays dirty, and is re-selected next run.
  - The log channel splits on "is the judge broken?", NOT on status. A `failed` whose 5xx retry
    ladder the deadline cut short carries `truncatedByDeadline` and logs on `console.warn` — the
    5xx counterpart of a `time_budget` deferral. A ladder that spent its last attempt is
    deliberately NOT marked, so `console.error` still means a genuinely down provider. Counting
    is unaffected: the summary counts by status, not by channel.
  - `attempted` means "handed to the judge, so it may have cost tokens", NOT "assessed" — it
    includes a throttled plant, which is `attempted: true` after up to `MAX_ATTEMPTS_PER_PLANT`
    real provider calls. `deferredUnattempted` is the subset of `deferred` that never reached the
    provider, which is what makes `selected = skipped + attempted + deferredUnattempted` hold.
  - Pacing is header-derived (`x-ratelimit-*`), not a sleep; `PHASE_ENGINE_TPM_LIMIT` only
    bootstraps it.
- **`GET /api/notifications/dispatch`** (Bearer `CRON_SECRET`, every 15 min via GitHub Actions):
  claims due rows atomically; at-most-once per `(notification_id, channel)` unique index. Also
  carries the DAILY oversight digest sweep — "owed" means _will produce_ a digest, and the sweep
  can never fail the run. Full semantics: `product-docs/features/notifications/frd.md` +
  `src/lib/notifications/`.
- **`/api/notifications/unsubscribe`** (no auth — sealed token): the GET half never mutates (303
  redirect, so scanners and prefetch are safe). The POST half is RFC 8058 one-click, CSRF-exempt
  in `src/proxy.ts`, reads everything from the token (DISABLE-only), and **always returns 200** —
  a 4xx makes mail clients retry or drop the control.
- **`POST /api/webhooks/resend`** (Svix signature): advances recipient status forward-only; hard
  bounce + complaint are prefixed `permanent: ` so retries never touch them.

Auth patterns for actions (actor from `verifySession()`, never a parameter; `"use server"`
export surface = auth surface) are invariants — see `../invariants.md` → Authentication.
