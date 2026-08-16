---
description: Build the board's frontier — claim unblocked issues, implement in isolated worktrees, code-review each branch.
---

Run the `frd-implement` workflow. Cursor has no Claude Code `agent()`/`phase()` runtime, so execute `.claude/workflows/frd-implement.js` as the procedure:

- Read that file first — its schemas, frontier query, and settle rules are the contract.
- Treat each `agent({ agentType })` call as a Cursor Task subagent (`architect`, `frontend`, `backend`, `code-reviewer`). Ask it to return JSON matching the schema in the script.
- Pass nothing to build the whole frontier, or `{issues:[...]}` to restrict the candidate set.

Args:

$ARGUMENTS
