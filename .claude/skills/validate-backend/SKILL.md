---
name: validate-backend
description: Functionally validate a backend/API/data-layer change by exercising the real route or server action and asserting response shape/status against the contract, plus verifying Drizzle migrations apply (and roll back, for high-risk). This is DoD gate G3 for backend units.
---

# validate-backend (DoD gate G3 — backend/API/data)

Proves a server change **behaves**, not just type-checks. Asserts against the contracts in
`memory/contracts/api.md` and `memory/contracts/db.md`.

## Preconditions

- **Give the worktree its env first:** `scripts/worktree-env.sh <worktree-dir>` (idempotent; the
  script's header says what it does and why). A worktree created for a track has no `.env.local`, so
  `pnpm test`, a `tsx` harness and `pnpm db:migrate` all fail on a missing `DATABASE_URL` — a harness
  failure that looks exactly like a broken track. Never hand-roll an env file instead.
- **Prefer a `tsx` harness in the worktree.** It imports the track's own code, so it exercises what
  you actually built. This is the default for pure functions, services and server actions.
- **For HTTP routes, use the branch's Vercel preview** (`./scripts/preview-url.sh --wait --bypass
  <pr-number>`), not `localhost:3000`. Localhost serves the **main checkout** — a route added on
  this branch either 404s there or, worse, resolves to the old implementation and passes.
- Read `memory/contracts/api.md` (route shapes) and `memory/contracts/db.md` (schema) before asserting.

## Procedure

1. **Exercise the surface** for each AC:
   - HTTP route → `curl -sS -i` (or `tsx`) with representative inputs incl. **one auth/permission case**
     and **one invalid-input case**. Assert **status code + JSON shape** vs the contract.
   - Server action / lib function → call it from a throwaway `tsx` script with real args; assert the return.
2. **Tenancy/auth** (if the unit touches them): prove a cross-tenant or unauthorized request is rejected
   (per `memory/invariants.md`).
3. **Migrations** (if schema changed):
   - `pnpm db:migrate` applies cleanly. Capture output.
   - Confirm the generated SQL lives in `src/db/migrations/` (generated via `pnpm db:generate`, **never**
     `db:push`).
   - **High-risk (HR1–HR3):** apply on a scratch/shadow DB, capture the **schema diff** (DDL delta), and
     prove **rollback** (down-migration or a documented, tested restore path) returns prior state.

## Output

Feed back into the `definition-of-done` report:

```json
{
  "g3": "PASS | FAIL",
  "acResults": [{ "ac": "...", "status": "PASS|FAIL", "request": "GET /api/...", "got": "200 {...}", "expected": "200 {...}" }],
  "authChecks": [{ "case": "cross-tenant read", "rejected": true }],
  "migration": { "applied": true, "schemaDiff": "<DDL or null>", "rollbackVerified": true },
  "notes": "..."
}
```

## Rules

- **Assert the contract, not the happy path only.** Always include an auth/permission case and an
  invalid-input case.
- **No `db:push`.** Migrations are versioned files via `db:generate` + `db:migrate`.
- **Don't mutate shared dev data destructively.** Prefer a scratch DB / transaction you can roll back,
  especially for migration checks.
- Validate; don't fix. Findings go back to the implementer.
