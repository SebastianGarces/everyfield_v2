---
name: browser-validation
description: Validate a feature worktree in a real browser through its managed local Portless URL. Use before claiming a visible or interactive change works and before shipping UI work.
---

# Browser validation through Portless

Read `ops/local-previews.md` for EveryField's configuration and data requirements, and
`.agents/skills/portless-preview/SKILL.md` for CLI lifecycle commands. A browser gate passes only
when the browser exercised the changed behavior on the selected worktree's preview.

## Start and identify the preview

Use development mode for live iteration and hot reload. For final acceptance, commit the change,
start a production-mode preview, and record its ID, URL, mode and SHA. Verify that SHA equals the
branch head. Production snapshots omit ignored environment files, so use the private configuration
described in `ops/local-previews.md`. No Git push is required.

Open the exact URL returned by `portless preview up`, with the needed route appended. Do not use
an existing server just because its port is familiar. After a code change, create a new production
preview and repeat the affected assertions. Development preview metadata does not prove that live
files still match its recorded commit.

## Sign in and choose data

Use the real login form for production-mode validation. Development-only account switching is
convenient during iteration but does not prove authentication. Never set hosting environment flags
or invent sessions to enable a test login. Use the credentials recorded for the preview's own
fixture database; do not print secrets in tool output or evidence.

Read `scripts/seed-dev-db.ts` and `scripts/seed-phase-engine-eval.ts` for fixture accounts.
`planter1@everyfield.app` has no people, so list-shaped criteria need populated fixtures such as
the eval planters. Oversight admin credentials come from the private `SEED_ADMIN_PASSWORD` used
when those accounts were created. Do not re-key an existing account to make a test convenient.
Seed only an explicitly owned disposable database; shared `.env.local` is not proof of ownership.
`pnpm db:seed` wipes data. Prefer the scoped seed that owns the fixture.

The accounts below exist only after the corresponding seed has run on the preview's database.

| Account | Email | Credential source |
| --- | --- | --- |
| Empty-state planter | `planter1@everyfield.app` | Dev seed fixture password |
| Network admin | `admin@everyfield.app` | `SEED_ADMIN_PASSWORD` in the preview's own `.env.local`; created by `--oversight-orgs-only` |
| Sending church admin | `sending-church-admin@everyfield.app` | `SEED_ADMIN_PASSWORD` in the preview's own `.env.local`; created by `--oversight-orgs-only` |
| Coach | `coach1@everyfield.app` | Dev seed fixture password |
| Populated planter | `planter-dayspring@eval.phase-engine.everyfield.app` | Eval seed fixture password |
| Second-church planter | `planter-evergreen@eval.phase-engine.everyfield.app` | Eval seed fixture password |

For oversight fixtures, first check whether the private preview environment already records the
password without printing it:

```sh
grep -E '^[[:space:]]*(export[[:space:]]+)?SEED_ADMIN_PASSWORD=' .env.local >/dev/null
```

If present, use the recorded value privately for login. Do not re-key. Only when provisioning new
fixtures on an owned disposable database, choose and record a private password in that worktree's
own `.env.local`, then run `pnpm exec tsx scripts/seed-dev-db.ts --oversight-orgs-only`. Never edit
a symlink to the main environment or append onto a partial last line. A production snapshot does
not copy this file; the recorded fixture credential stays available privately to the reviewer.

For tenancy work, use two accounts from different churches. Switch accounts with the real sign-out
flow or a fresh browser context, then return to `/login`. For registration, configure the private
preview's beta code or follow a real invitation flow as appropriate to the acceptance criterion.
Mail-sending flows require an independently verified capture-only transport.

## Exercise, report and finish

Follow `.agents/skills/validate/SKILL.md` for assertions and audit requirements. Prove the
interaction: an export test inspects the downloaded content, not just the button. Capture relevant
console errors and do not dismiss them as hosting noise.

Retain the decisive evidence outside the worktree, with the tested commit and results. Close tabs
or browser contexts created for this task on success and failure. If another reviewer needs the
preview, hand off its identity, private configuration location, bounded lease and cleanup ownership.
Otherwise stop it. Remove the worktree only when its users are finished and its changes are safely
committed; verify cleanup as described in the Portless skill. Report an unavailable browser or
missing configuration as unverified, never as a pass.
