---
name: validate-frontend
description: Functionally validate a frontend/fullstack change against the branch's Vercel preview deployment using the Playwright MCP and chrome-devtools MCP. Use to prove a UI acceptance criterion actually works (not just compiles) — assert the outcome, require a clean console, screenshot, and run a lighthouse a11y audit. This is DoD gate G3 for frontend units.
---

# validate-frontend (DoD gate G3 — frontend/fullstack)

Proves a UI change **works against the running app**. Compiling is not done; this gate is what
"done" actually means for the user.

## Preconditions

- **Give the worktree its env first:** `scripts/worktree-env.sh <worktree-dir>` (idempotent; the
  script's header says what it does and why). A worktree created for a track has no `.env.local`, so
  anything you run there — `pnpm test` above all — fails on a missing `DATABASE_URL`, which reads as
  a broken track when it is a broken harness. Never hand-roll an env file instead.

- **Validate on the branch's Vercel preview deployment — never `localhost:3000`.** Localhost serves
  the **main checkout**, so it does not contain this track's work: driving it produces a confident
  pass for code that was never executed. This is not hypothetical — it is why the CSV-export track
  had to ship with its browser gate unmet.

  ```bash
  ./scripts/preview-url.sh --wait --bypass <pr-number>   # use as the FIRST navigation
  ```

  Read `.claude/skills/browser-validation/SKILL.md` before the first run. Two traps live there:
  the dev account switcher does **not** exist on previews (log in with a seeded account, and note
  eval planters use a different password), and `planter1@everyfield.dev`'s church has **zero
  people** — useless for validating anything list-shaped.

- **Sequencing:** the preview is created by the push, so the PR opens with G3 at ⏳, gets validated,
  then has its body edited to ✅. If `preview-url.sh` cannot find a successful deployment, return
  `FAIL` with `failingGate: "G3"` — do not fall back to localhost, and do not start a server.

- **Re-fetch the URL after every push.** Each push builds a new deployment; an old URL keeps serving
  old code and will happily "prove" a fix that is not there.

- MCPs used (load via ToolSearch if their schemas aren't present):
  - **Playwright MCP** — `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`,
    `browser_fill_form`, `browser_evaluate`, `browser_console_messages`, `browser_take_screenshot`,
    `browser_wait_for`.
  - **chrome-devtools MCP** — `lighthouse_audit` (+ `list_console_messages`, `list_network_requests`
    if you need network/console depth).

## Procedure (per acceptance criterion)

0. `browser_navigate` to the `--bypass` URL **once** — Vercel sets a cookie on the redirect, so
   every later navigation can use plain paths. Then sign in through the real login form with a
   seeded account (see the browser-validation skill's account table).
1. `browser_navigate` to the route under test.
2. `browser_snapshot` to get the accessibility tree, then drive the interaction the AC describes
   (`browser_click` / `browser_type` / `browser_fill_form`).
3. **Assert the outcome** the AC promises — prefer `browser_evaluate` to read concrete DOM/state
   (text content, attribute, count, URL) over eyeballing. One assertion per AC, minimum.
4. `browser_take_screenshot` of the key state (name it `<issue>-<ac-slug>.png`). Save it to your
   session scratchpad directory — **never the repo root or anywhere inside the working tree**. The
   screenshot's durable home is the PR body; anything on disk is temporary.
5. After exercising all ACs, pull `browser_console_messages`. **Any `error` → FAIL** (warnings noted).
   One known exception on previews: a single `403` per page load from a `HEAD` request made by the
   Vercel preview toolbar. It is infrastructure, not the app — confirm that is what you are looking
   at, and do not let it mask a real error underneath.
6. Run `lighthouse_audit` on the primary touched page. **Accessibility ≥ 90** to pass; record
   performance / best-practices / SEO but treat them as non-blocking unless the issue's ACs say otherwise.

## Output

Feed these back into the `definition-of-done` report:

```json
{
  "g3": "PASS | FAIL",
  "acResults": [{ "ac": "...", "status": "PASS|FAIL", "assertion": "evaluate() === expected", "screenshot": "<ref>" }],
  "consoleErrors": [],
  "lighthouse": { "accessibility": 96, "performance": 82, "bestPractices": 100 },
  "notes": "..."
}
```

## Rules

- **Assert, don't admire.** A screenshot alone is not a pass — there must be a programmatic assertion per AC.
- **Console-clean.** Runtime errors in the console fail the gate even if the screenshot looks right.
- **Real flow, real data.** Use the seeded DB and real navigation; don't stub the thing you're validating.
- **Never localhost.** It serves `main`. A pass obtained there is a pass for someone else's code.
- **Leave it clean.** The preview writes to the shared development database — prefer reading, and
  clean up what you create. `browser_close` the page when done so the next track starts fresh.
- **No screenshot litter.** Evidence screenshots live in the scratchpad and the PR body only. If
  any `.png` landed in the working tree during validation, delete it before the track ends —
  `git status` must show no stray images.
