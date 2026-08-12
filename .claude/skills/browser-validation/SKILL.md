---
name: browser-validation
description: Validate a feature branch in a real browser using its Vercel preview deployment. Use whenever an acceptance criterion describes something a user sees or clicks — before claiming a UI change works, and before opening a PR whose Definition of Done includes a functional/browser gate.
---

# Browser validation against preview deployments

## The problem this exists to solve

`localhost:3000` serves the **main checkout**. A feature branch — especially one built in a
worktree — is never the thing being served there, so driving the browser at localhost proves
nothing about your change. Never start your own dev server to work around this (see the dev server
rule in `AGENTS.md`).

Every PR to `main` gets a Vercel preview deployment. That is the branch, built and served. Validate
there.

## Procedure

### 1. Push the branch and open the PR

The preview is created by the push, so validation happens **on the PR**, not before it. If your
Definition of Done has a browser gate, open the PR with that gate marked ⏳, validate, then edit the
PR body with the evidence. A PR is allowed to exist in an unvalidated state for the minutes that
takes; a PR is not allowed to *claim* a browser gate it never ran.

### 2. Get the preview URL

```bash
./scripts/preview-url.sh --wait --bypass <pr-number>
```

- `--wait` blocks until the deployment is ready (builds take ~2 min)
- `--bypass` appends the protection-bypass parameters — **required**, see below

Without `--bypass` the browser lands on `vercel.com/login`, not the app. Preview deployments are
behind Vercel Authentication (`ssoProtection: all_except_custom_domains`), which is a good default
worth keeping: previews point at the development database, which holds real people's data.

The bypass secret comes from `VERCEL_AUTOMATION_BYPASS_SECRET` in `.env.local`. If the script says
it is unset, stop and ask — do not disable deployment protection to get around it.

### 3. Navigate once with the bypass URL

Use the full URL from step 2 as your **first** navigation. Vercel answers with a `Set-Cookie`
redirect, so every later navigation in that browser session is already authorized and you can use
plain paths:

```
navigate → https://everyfield-v2-<hash>.vercel.app?x-vercel-protection-bypass=…&x-vercel-set-bypass-cookie=true
navigate → https://everyfield-v2-<hash>.vercel.app/people
```

### 4. Log in with a seeded account

**The dev account switcher does not exist on previews.** It is gated on
`NODE_ENV === "development" && !process.env.VERCEL`, checked in three independent places, and Vercel
builds are production builds. This is deliberate — do not try to enable it, and do not add an env
var that would. A passwordless one-click switcher on a publicly-addressable URL is precisely the
thing that guard prevents.

Log in through the real form instead. Preview deployments read the same development Neon branch as
local dev, so the seeded accounts work:

| Account | Email | Password | Notes |
|---|---|---|---|
| Planter | `planter1@everyfield.app` | `password123` | **Church has 0 people** — fine for empty states, useless for anything about a list |
| Network admin | `admin@everyfield.app` | not in this repo — read `SEED_ADMIN_PASSWORD` from `.env.local`; set it there and run `seed-dev-db.ts --oversight-orgs-only` (full command below) | Owns "Dev Church Planting Network". Its `sending_network_id` is what `/oversight/invitations` needs; without it the page says "Set up your network first" and no invitation can be sent |
| Sending church admin | `sending-church-admin@everyfield.app` | not in this repo — read `SEED_ADMIN_PASSWORD` from `.env.local`; set it there and run `seed-dev-db.ts --oversight-orgs-only` (full command below) | Belongs to "Dev Sending Church", which belongs to NO network — so `/settings/association` opens on the admin's *answering* view. Added #304 round 6; before it the dev DB held no `sending_church_admin` at all and this whole role was unreachable in a browser |
| Coach | `coach1@everyfield.app` | `password123` | |
| Eval planter | `planter-dayspring@eval.phase-engine.everyfield.app` | `eval-password-123` | ~100 people, meetings, assessments |
| Eval planter | `planter-evergreen@eval.phase-engine.everyfield.app` | `eval-password-123` | ~89 people, different church |

These are on `everyfield.app` — the product domain, ruled 2026-07-31. The placeholder domain the
seeds used before it is retired, and the accounts on it no longer exist: if a login here fails with
"invalid credentials", check you are not quoting an older copy of this table before you conclude the
form is broken. The addresses come from `scripts/seed-dev-db.ts` and
`scripts/seed-phase-engine-eval.ts`; those files are the source of truth and this table follows them.

**Note the different password for eval accounts** — they are seeded by
`scripts/seed-phase-engine-eval.ts`, not `seed-dev-db.ts`.

**On the database you are validating against, the two oversight admins have no password in this
repository** (#304, ruled 2026-08-10). No in-repo constant may open an account on a database anyone
else uses. **It lives in `.env.local` instead** — gitignored and machine-local, beside the
`VERCEL_AUTOMATION_BYPASS_SECRET` you already need for step 2, so it is readable by whoever is
validating and by nobody who can only read the repo. **Read it there first; do not invent one and do
not re-seed if it is already set.**

(`scripts/seed-dev-db.ts`'s FULL seed does give these two `password123` like everyone else — but a
full seed wipes every user and church, so it only ever runs against a throwaway database. The shared
development branch a preview reads is never full-seeded, which is why `password123` has never opened
these two accounts there.)

```bash
# 1. Is it already recorded? If this prints a value, that is the password — use it and stop.
#    -E and the optional `export` matter: the seed accepts both spellings, and a grep that
#    misses one tells you "nothing recorded" for a password someone else already set.
grep -E '^[[:space:]]*(export[[:space:]]+)?SEED_ADMIN_PASSWORD=' .env.local

# 2. Only if it printed nothing: choose one, record it, then run the seed.
#    printf with a leading newline, never `echo >>`: .env.local may not end in one, and an
#    append onto a partial last line silently corrupts that variable and this one.
printf '\nSEED_ADMIN_PASSWORD="<a password you choose>"\n' >> .env.local
pnpm exec tsx scripts/seed-dev-db.ts --oversight-orgs-only
```

Passing the value inline instead (`SEED_ADMIN_PASSWORD=… pnpm exec tsx …`) still re-keys the
accounts, and the script will warn you that nothing recorded it. Heed that warning: an unrecorded
password is what stranded this fixture between #304 rounds 8 and 10 — the accounts existed, worked
for exactly one person, and no later verifier could sign in to exercise a single interactive
criterion.

That mode deletes nothing. It upserts the sending network, the sending church, and both admin rows
— setting the password you passed, the role and the org FKs — so one command leaves a usable
oversight fixture on both sides even if the accounts already exist with a forgotten password or a
NULL org FK. It refuses outright, writing nothing, on any database holding an alpha-cohort account,
and there is no override for that: point `DATABASE_URL` at the database you are validating against
(a preview reads the development branch) and never at production.

**Which database does it actually succeed against?** The **Neon `development` branch** — the one a
preview reads and the one `DATABASE_URL` in `.env.local` names. Step 2 is expected to work there,
and the refusal above is not a contradiction: the guard asks exactly one question, *are any of the
three `PROTECTED_ACCOUNTS` sentinels present*, and on the development branch the answer is **no**
(read-only probe run 2026-08-12 for #304 round 10 — 0 of 3 present; the alpha-cohort logins
`memory/invariants.md` → Dev Seeds warns the WIPE about are not these three addresses). The full
step-2 command was then run once end to end against that branch and printed its four upsert lines,
so this path is exercised, not merely documented. Re-run the probe rather than assuming it: if a
sentinel is ever added there, this mode has no override and the only honest recovery is a statement
written by hand for that database, with the password chosen there.

**Production is a different answer** — it holds the sentinels by definition, so the mode refuses and
must. Never reach for `--allow-protected-db` here; it is the *wipe's* flag and does not exist for
this mode.

**If the eval logins are gone, someone ran `pnpm db:seed`.** That script wipes the whole fixture —
every user and every church, not just the nine it creates — so it takes the eval corpus with it, and
with it the marketing-church fixture and any account someone registered by hand. Put the corpus back
with `pnpm exec tsx scripts/seed-phase-engine-eval.ts` and the marketing church with
`pnpm exec tsx scripts/seed-marketing-church.ts`; both are deterministic, so they come back
identical. (The wiki articles survive every seed by design — they are migrated content, and the wipe
refuses to touch them.) Prefer the scoped eval seed on its own: its cleanup only touches the eval
network, so it costs nobody else their fixture.

**Landing in the onboarding wizard instead of the dashboard is a seed problem, not a bug.** A
planter whose church has a null `onboarding_completed_at` gets the four-step wizard — both seeds
stamp it, so a church that lands you there was created some other way (a registration, a scratch
harness). Re-run the seed that owns that church rather than filing the dashboard as broken.

Reach for an eval planter whenever the criterion involves data. Checking a list feature against a
church with nothing in it produces a screenshot of an empty state and proves nothing.

Tenancy-sensitive work must be checked from **two** accounts in different churches. That a
church-scoped list looks right for one user is not evidence it is scoped at all — the two eval
planters above are the easy pair, and their records are name-prefixed by church so overlap is
obvious.

### Switching accounts

There is no sign-out route to navigate to, and the session cookie is `httpOnly`, so
`document.cookie` cannot clear it. Clear at the context level and re-apply the bypass:

```js
await page.context().clearCookies();
await page.goto('<preview>/login?x-vercel-protection-bypass=…&x-vercel-set-bypass-cookie=true');
```

### 5. Drive it and capture evidence

Use the Playwright MCP tools. What counts as evidence:

- **The interaction, not the render.** "The Export button is present" is a screenshot of an
  assumption. "Clicked Export, a CSV downloaded, it had N rows matching the filtered list" is
  evidence.
- **The filtered/empty/error states** an AC mentions, not only the happy path.
- **A snapshot or screenshot reference** in the PR body for anything visual. Save screenshot
  files to the session scratchpad, never inside the working tree — the PR body is the durable
  home; delete any stray `.png` before the track ends.
- **Console output**, checked. A clean render with a red console is not a pass.

**Known console noise on previews:** one `Failed to load resource: 403` per page load, from a `HEAD`
request the Vercel preview toolbar makes to the page URL. It is infrastructure, not the app — verify
it is that before reporting it, and do not let it hide a real error underneath.

### Capturing a download

For anything that produces a file, capture and parse it — the download is the evidence, not the
click:

```js
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByRole('button', { name: 'Export', exact: true }).click(),
]);
await download.saveAs('<scratchpad>/export.csv');
download.suggestedFilename();   // assert the filename convention too
```

Then check the contents against what the UI claimed: if the list header said "3 total", the file has
3 data rows, and they are the right 3.

### 6. Write the result into the PR

Replace the ⏳ gate with the outcome and what you actually did. If something failed, say so and keep
the gate open — that is the entire point of the loop.

## Costs and limits worth knowing

- The preview is a **production build**: no HMR, no dev overlay, no source maps in the console. Fix
  code locally, push, wait for the new preview.
- It writes to the **development database**, shared with local dev and the deployed cron. Data you
  create is real and other people see it. Prefer reading; clean up what you write.
- Each push builds a new deployment with a new hash. Re-run `preview-url.sh` after every push — an
  old URL keeps serving the old code and will happily "prove" a fix that is not there.

## Teardown (mandatory, PASS or FAIL)

The last browser action of a validation run is closing what it opened: Playwright →
`browser_close`; chrome-devtools → `list_pages`, then `close_page` for every page you created.
This is not tidiness — the browser outlives the agent, and a long dispatch pass that leaks one
browser per verification exhausts the machine's RAM (it froze the host on 2026-08-09). The
pass-boundary sweep (`scripts/cleanup-mcp-browsers.sh`) only catches agents that died before
teardown; a live agent closes its own browser.

## When you cannot validate

Say so explicitly, in the PR, with the reason. An honest ⏳ is worth more than a ✅ that means
"looked at the code." The one thing that must never happen is a Definition of Done reporting a
browser gate as passed when no browser was involved.
