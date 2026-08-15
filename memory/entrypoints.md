# Entrypoints

The codebase is the map — this file only tells you where to start looking. It used to mirror
every flow in a table; that mirror is gone (git history has it).

## Where flows start

- **Pages / routes:** `src/app/` (App Router). Route groups: `(marketing)` public, `(auth)`
  login/register, `(dashboard)` everything behind the session guard in its `layout.tsx`.
- **Mutations:** colocated `actions.ts` next to the page that uses them (`"use server"`), or
  feature libs under `src/lib/<feature>/`. Every export of a `"use server"` module is a public
  POST endpoint — see `invariants.md` → Authentication before touching one.
- **API route handlers:** `src/app/api/<route>/route.ts`. The non-obvious ones (cron, webhooks,
  tokened public routes) are in `contracts/api.md`.
- **DB schema:** `src/db/schema/*.ts`, one file per feature area. Non-obvious column semantics:
  `contracts/db.md`.
- **The launch date** is not a column on `churches` — it is the `launches` entity
  (`src/db/schema/launch.ts`). Reads: `src/lib/launch/queries.ts`. The one write path:
  `setLaunchDate` in `src/lib/launch/service.ts`. Countdown math: `countdown.ts` there and only
  there (`invariants.md` → Hierarchical Access Control, the day-vs-instant rule).
- **Auth:** `src/lib/auth/` (`session.ts:getCurrentSession()` runs on every authed request).
- **Events:** `src/lib/events/event-bus.ts`; feature handlers subscribe in
  `src/lib/tasks/events.ts` and its siblings.
- **Redirect/proxy behavior** (authed users hitting `/`, CSRF exemptions): `src/proxy.ts`.
- **Anything visual:** `DESIGN.md` at the repo root is the design authority.
