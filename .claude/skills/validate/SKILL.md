---
name: validate
description: Prove acceptance criteria against a local Portless production preview of the final commit, or a real backend harness. Use for functional validation before shipping a behavior change.
---

# validate (the WORKS gate)

Prove each acceptance criterion against the **running** thing, at the final sha. **Assert, don't
admire:** a screenshot or a 200 is not a pass without a programmatic assertion per AC. Thin evidence
defaults to **FAIL**, and if you could not validate, say so plainly with the reason — an honest ⏳
beats a ✅ that means "looked at the code". Validate; don't fix.

## Frontend / fullstack — one browser look

Reach the Portless production-mode preview per `.agents/skills/browser-validation/SKILL.md` and
verify its recorded SHA equals the final branch head. Sign in using that preview's fixture
credentials. `planter1@everyfield.app` has zero people, so list-shaped work needs populated data.
Docs-only changes use relevant document/config checks and mark browser validation not applicable.

1. Drive the interaction the AC describes, then **assert the outcome** with the host browser's
   evaluate or DOM-inspection capability reading concrete DOM or state — one assertion per AC,
   minimum.
2. One screenshot of the decisive state, in the session scratchpad, never in the working tree.
3. Pull the console. **Any `error` fails the gate**; diagnose it rather than granting a hosting exception.
4. Run the host's Lighthouse/accessibility audit on the primary touched page:
   **accessibility ≥ 90** to pass. If the host exposes no automated audit, report that gate as
   unverified rather than inventing a score.
5. While you are there, judge layout, hierarchy and copy — not only defects. Apply what you can and
   name what you leave.
6. Close the tabs or contexts you opened. Keep evidence outside the worktree and follow the
   Portless handoff/cleanup instructions. Report preview ID, URL, mode, SHA and cleanup status.

## Backend / API / data — one real request

Prefer a `tsx` harness in the worktree, which imports the track's own code; use the preview for HTTP
routes. Read the route or action source plus `memory/contracts/api.md` and `memory/contracts/db.md`
for the expected shape first.

- Assert **status code and response shape** per AC, always including **one auth/permission case**
  and **one invalid-input case**.
- Where the unit touches tenancy, prove a cross-tenant or unauthorized request is rejected.
- If the diff touches `src/db/migrations/` — read that off the diff, not off the plan — prove the
  migration applies **and rolls back** (versioned files via `pnpm db:migrate`, never `db:push` —
  `AGENTS.md`), and **keep both transcripts verbatim**: the PR body owes both directions, and the
  DDL delta alone is a FAIL of this gate.
- Use a scratch DB, never the shared development database, and never one you cannot throw away.
