---
name: validate-frontend
description: Functionally validate a frontend/fullstack change against the running app using the Playwright MCP and chrome-devtools MCP. Use to prove a UI acceptance criterion actually works (not just compiles) — navigate localhost:3000, assert the outcome, require a clean console, screenshot, and run a lighthouse a11y audit. This is DoD gate G3 for frontend units.
---

# validate-frontend (DoD gate G3 — frontend/fullstack)

Proves a UI change **works against the running app**. Compiling is not done; this gate is what
"done" actually means for the user.

## Preconditions

- The dev server must be running at `http://localhost:3000`. **Do not start it** (per `AGENTS.md`).
  Check first: `curl -sS -o /dev/null -w "%{http_code}" http://localhost:3000` (or a known route).
  If it's down → return `FAIL` with `failingGate: "G3"` and a note that the human must start the dev
  server; do not try to launch one.
- MCPs used (load via ToolSearch if their schemas aren't present):
  - **Playwright MCP** — `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`,
    `browser_fill_form`, `browser_evaluate`, `browser_console_messages`, `browser_take_screenshot`,
    `browser_wait_for`.
  - **chrome-devtools MCP** — `lighthouse_audit` (+ `list_console_messages`, `list_network_requests`
    if you need network/console depth).

## Procedure (per acceptance criterion)

1. `browser_navigate` to the route under test (sign in first if the flow needs auth — use seeded dev
   credentials; never hardcode secrets).
2. `browser_snapshot` to get the accessibility tree, then drive the interaction the AC describes
   (`browser_click` / `browser_type` / `browser_fill_form`).
3. **Assert the outcome** the AC promises — prefer `browser_evaluate` to read concrete DOM/state
   (text content, attribute, count, URL) over eyeballing. One assertion per AC, minimum.
4. `browser_take_screenshot` of the key state (name it `<issue>-<ac-slug>.png`).
5. After exercising all ACs, pull `browser_console_messages`. **Any `error` → FAIL** (warnings noted).
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
- **Real flow, real data.** Use the seeded dev DB and real navigation; don't stub the thing you're validating.
- **Leave it clean.** `browser_close` the page when done so the next track starts fresh.
