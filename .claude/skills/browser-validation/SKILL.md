---
name: browser-validation
description: Validate a feature branch in a real browser using its Vercel preview deployment. Use whenever an acceptance criterion describes something a user sees or clicks — before claiming a UI change works, and before opening a PR whose Definition of Done includes a functional/browser gate.
---

# Browser validation against preview deployments

The one reference for reaching a preview. A Definition of Done must never report a browser gate as
passed when no browser was involved — if you cannot validate, say so in the PR with the reason.

`localhost:3000` serves the **main checkout**, so a pass obtained there is a pass for someone else's
code, and you never start your own dev server (`AGENTS.md`). Every PR to `main` gets a preview
deployment: the branch, built and served. Validate there.

## 1. Get the preview URL

The push creates the preview, so validation happens **on the PR**: open it with the browser gate at
⏳, validate, then edit the body with the evidence.

```bash
./scripts/preview-url.sh --wait --bypass <pr-number>
```

`--wait` blocks until the deployment is ready (~2 min). `--bypass` appends the protection-bypass
parameters and is **required** — without it the browser lands on `vercel.com/login`. The secret is
`VERCEL_AUTOMATION_BYPASS_SECRET` in `.env.local`; if the script says it is unset, stop and ask.
Never disable deployment protection to get around it.

**Re-run the script after every push** — an old URL serves old code and will happily "prove" a fix
that is not there. The preview is a production build (no HMR, no source maps) and writes to the
**shared development database**: prefer reading, and clean up what you write.

## 2. Navigate once with the bypass URL

Use the full URL as your **first** navigation. Vercel answers with a `Set-Cookie` redirect, so every
later navigation can use plain paths:

```
navigate → https://everyfield-v2-<hash>.vercel.app?x-vercel-protection-bypass=…&x-vercel-set-bypass-cookie=true
navigate → https://everyfield-v2-<hash>.vercel.app/people
```

## 3. Log in with a seeded account

**The dev account switcher does not exist on previews** — it is gated on `NODE_ENV ===
"development" && !process.env.VERCEL`. Log in through the real form; previews read the same
development database as local dev.

| Account | Email | Password | Notes |
|---|---|---|---|
| Planter | `planter1@everyfield.app` | `password123` | **Church has 0 people** — fine for empty states, useless for anything list-shaped |
| Network admin | `admin@everyfield.app` | read `SEED_ADMIN_PASSWORD` from `.env.local`; set it there and run `seed-dev-db.ts --oversight-orgs-only` (block below) | Owns "Dev Church Planting Network" — its `sending_network_id` is what `/oversight/invitations` needs |
| Sending church admin | `sending-church-admin@everyfield.app` | read `SEED_ADMIN_PASSWORD` from `.env.local`; set it there and run `seed-dev-db.ts --oversight-orgs-only` (block below) | In "Dev Sending Church", which is in NO network — so `/settings/association` opens on its *answering* view |
| Coach | `coach1@everyfield.app` | `password123` | |
| Eval planter | `planter-dayspring@eval.phase-engine.everyfield.app` | `eval-password-123` | ~100 people, meetings, assessments |
| Eval planter | `planter-evergreen@eval.phase-engine.everyfield.app` | `eval-password-123` | ~89 people, different church |

`scripts/seed-dev-db.ts` and `scripts/seed-phase-engine-eval.ts` are the source of truth; this table
follows them. **No in-repo constant may open an account on a database anyone else uses**, so the two
oversight admins have no password here. Read it first; never re-key one someone else recorded.

```bash
# 1. Already recorded? A value here IS the password — use it and stop. The `-E` and the
#    optional `export` matter: the seed accepts both spellings.
grep -E '^[[:space:]]*(export[[:space:]]+)?SEED_ADMIN_PASSWORD=' .env.local

# 2. Only if that printed nothing. printf with a leading newline, never `echo >>`, which
#    appends onto a partial last line and silently corrupts both variables.
printf '\nSEED_ADMIN_PASSWORD="<a password you choose>"\n' >> .env.local
pnpm exec tsx scripts/seed-dev-db.ts --oversight-orgs-only
```

That mode deletes nothing — it upserts the two orgs and both admin rows — and refuses, with no
override, on any database holding an alpha-cohort account. Point `DATABASE_URL` at the development
branch a preview reads, never at production. If any other fixture is missing, re-run the scoped seed
that owns it (`scripts/seed-*.ts`) rather than `pnpm db:seed`, whose wipe takes the rest with it.

Use an eval planter whenever the criterion involves data, and check tenancy-sensitive work from
**two** accounts in different churches.

**Switching accounts:** there is no sign-out route and the session cookie is `httpOnly`, so clear at
the context level and re-apply the bypass:

```js
await page.context().clearCookies();
await page.goto('<preview>/login?x-vercel-protection-bypass=…&x-vercel-set-bypass-cookie=true');
```

## 4. Drive it and capture evidence

The gate thresholds live in `.claude/skills/validate/SKILL.md`. Two facts belong here. Evidence is
**the interaction, not the render**: "clicked Export, a CSV downloaded, it had N rows matching the
filtered list", never "the Export button is present" — parse the file, do not photograph the click.
And the one known console noise on previews is a single `Failed to load resource: 403` per page
load, from the Vercel toolbar's `HEAD` request; verify that is what you have before dismissing it.

## 5. Teardown (mandatory, PASS or FAIL)

The last browser action is closing what you opened: Playwright → `browser_close`; chrome-devtools →
`list_pages`, then `close_page` for every page you created. A leaked browser outlives the agent and
a long pass leaks until the machine is out of RAM; `scripts/cleanup-mcp-browsers.sh` only catches
agents that died first. Delete any stray `.png` too, then write the outcome into the PR in place of
the ⏳.
