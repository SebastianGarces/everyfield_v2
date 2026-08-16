---
description: Decompose an FRD into file-disjoint tracks and publish them to the GitHub board. No code is written.
---

Run the `frd-plan` workflow. Cursor has no Claude Code `agent()`/`phase()` runtime, so execute `.claude/workflows/frd-plan.js` as the procedure:

- Read that file first — its schemas and grouping rules are the contract.
- Treat each `agent({ agentType })` call as a Cursor Task subagent (`architect`, `frontend`, `backend`, `code-reviewer`). Ask it to return JSON matching the schema in the script.
- Run the deterministic sections yourself (DSU grouping, `gh` publish).
- `publish:false` plans without touching the board.

Args — the FRD path, or `{frd, scope, publish:false}`:

$ARGUMENTS
