# Entrypoints

The codebase is the map — this file only tells you where to start looking. It used to mirror
every flow in a table; that mirror is gone (git history has it) because a session finds the
real thing faster with the conventions below.

## Where flows start

- **Pages / routes:** `src/app/` (App Router). Route groups: `(marketing)` public, `(auth)`
  login/register, `(dashboard)` everything behind the session guard in its `layout.tsx`.
- **Mutations:** colocated `actions.ts` next to the page that uses them (`"use server"`), or
  feature libs under `src/lib/<feature>/`. Every export of a `"use server"` module is a public
  POST endpoint — see `invariants.md` → Authentication before touching one.
- **API route handlers:** `src/app/api/<route>/route.ts`. The non-obvious ones (cron, webhooks,
  tokened public routes) are listed in `contracts/api.md`.
- **DB schema:** `src/db/schema/*.ts` (one file per feature area). Non-obvious column semantics:
  `contracts/db.md`.
- **Auth:** `src/lib/auth/` (`session.ts:getCurrentSession()` runs on every authed request).
- **Events:** `src/lib/events/event-bus.ts`; feature handlers subscribe in `src/lib/tasks/events.ts` etc.
- **Redirect/proxy behavior** (authed users hitting `/`, CSRF exemptions): `src/proxy.ts`.

## Orientation shortcuts

- Flow diagrams (intent, not code): `flows/*.mmd` — auth, wiki-article, request-lifecycle, person-status.
- Design authority for anything visual: `DESIGN.md` at repo root (sharp system, ruled 2026-07-30).
- Feature requirements and rulings: `product-docs/features/<feature>/frd.md`; build status lives
  on the GitHub board (`gh issue list --label feature`), not in a file.
