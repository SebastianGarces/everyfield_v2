---
description: Build a wave of tracks autonomously to reviewed PRs (implement → one review → one browser look → PR).
---

Run the `build-until-done` loop. Cursor has no Claude Code `agent()`/`phase()` runtime, so execute `.claude/workflows/build-until-done.js` as the procedure:

- Read that file first — its schemas, gates, worktree layout, and ship rules are the contract. Do not re-implement any of it.
- Treat each `agent({ agentType })` call as a Cursor Task subagent (`architect`, `frontend`, `backend`, `code-reviewer`). Ask it to return JSON matching the schema in the script.
- `autoMerge` is off unless the caller opted in. Factory-path and `risk:high` tracks never auto-merge.

Args — the wave's units array, or `{units, base, autoMerge, reserve, maxConcurrentAgents}`:

$ARGUMENTS
