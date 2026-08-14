---
name: validate
description: Functionally validate a change against the running thing — one browser look at the branch's Vercel preview for UI, or one real request asserting status and shape for backend. Use to prove an acceptance criterion actually works, not that it compiles. This is the DoD WORKS gate.
---

# validate (the WORKS gate)

Prove each acceptance criterion against the **running** thing, at the final sha. **Assert, don't
admire:** a screenshot or a 200 is not a pass without a programmatic assertion per AC. Thin evidence
defaults to **FAIL**, and if you could not validate, say so plainly with the reason — an honest ⏳
beats a ✅ that means "looked at the code". Validate; don't fix.

## Frontend / fullstack — one browser look

Reach the preview per `.claude/skills/browser-validation/SKILL.md` (never `localhost`; re-fetch the
URL after every push). Sign in with a seeded account — `planter1@everyfield.app` has zero people, so
anything list-shaped needs an eval planter.

1. Drive the interaction the AC describes, then **assert the outcome** with `browser_evaluate`
   reading concrete DOM or state — one assertion per AC, minimum.
2. One screenshot of the decisive state, in the session scratchpad, never in the working tree.
3. Pull the console. **Any `error` fails the gate**, except the single Vercel preview-toolbar `403`.
4. `lighthouse_audit` on the primary touched page: **accessibility ≥ 90** to pass.
5. While you are there, judge layout, hierarchy and copy — not only defects. Apply what you can and
   name what you leave.
6. **Close the browser** before writing the report, and delete any stray `.png`.

## Backend / API / data — one real request

Prefer a `tsx` harness in the worktree, which imports the track's own code; use the preview for HTTP
routes. Read the route or action source plus `memory/contracts/api.md` and `memory/contracts/db.md`
for the expected shape first.

- Assert **status code and response shape** per AC, always including **one auth/permission case**
  and **one invalid-input case**.
- Where the unit touches tenancy, prove a cross-tenant or unauthorized request is rejected.
- If the change alters schema, prove the migration applies and that you can get back (versioned
  files via `pnpm db:migrate`, never `db:push` — `AGENTS.md`).
- Prefer a scratch DB or a transaction you can roll back; the development database is shared.
