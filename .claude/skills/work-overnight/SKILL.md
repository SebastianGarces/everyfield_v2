---
name: work-overnight
description: Run dispatch passes on a loop unattended until a stop time, then report. Use when Sebastian says "work overnight", "run dispatch on loop", or invokes /work-overnight. Args: optional stop time (e.g. "stop at 9am").
---

# work-overnight

Sebastian is asleep. You are the orchestrator. Run dispatch passes on a loop until the stop time, then write one report of everything done.

## Setup

1. Run `/standup` first if it has not run this session. Rule open decisions; do not wait on them.
2. Note the stop time from the args. If none is given, ask before starting — this is the one input the loop needs.

## The loop

Each iteration:

1. Run one dispatch pass per `.agents/skills/dispatch/SKILL.md` — take unblocked, unclaimed frontier issues and build them to PRs.
2. Dispatch as many agents as the frontier supports. Around 6 parallel tracks is a good ceiling; use judgment on collisions (file ownership, shared surfaces).
3. **Model discipline:** spawned agents inherit the host's configured model and reasoning effort
   unless Sebastian explicitly requests an override. The orchestrator does not implement; it
   dispatches, monitors, reviews, and merges.
4. Between passes, use the host's supported wakeup or automation mechanism, sized to the work in
   flight — long fallback (20+ min) when agents are running, immediate next pass when the frontier
   still has takeable work and slots are free.
5. Keep agents working. When one finishes, review its PR, fix or re-dispatch follow-ups, and backfill its slot from the frontier.

## Standing rules

- **Decisions:** make them yourself and record them (`product-docs/decisions.md` for product, PR body for code). Never block on Sebastian. Keep working on any follow-up a decision creates.
- **Browser MCP hygiene:** headless Chrome (chrome-devtools MCP) and Playwright MCP leak contexts across parallel tracks. Clean them up constantly — close pages after each validation, and kill orphaned headless Chrome/Playwright processes between passes (`pkill -f "chrome.*headless"`, check `ps` for stray `mcp-chrome`/`playwright` processes).
- **Context hygiene:** keep your own context lean. Route bulk output to subagents; hold summaries only. Roughly every hour, shed stale context (compaction) so you stay fresh for the whole night.
- **Quality bar is unchanged:** the engineering principles and `ops/process.md` apply in full overnight. Ship to the normal bar; make every agent aware the bar is not lowered. File follow-ups for genuine scope cuts, never as a substitute for doing the work right.
- **Stop time is soft:** treat the target as approximate. Never interrupt in-flight work to hit it; let running tracks finish and choose a stopping point close to the target. Stop dispatching new work as the target nears.
- **No collisions:** one claim per issue (`agent:in-progress`), worktrees for parallel branches, fresh `pnpm install` per worktree.

## Stop and report

At the stop time: stop dispatching new work, let in-flight agents land, then post one report to Sebastian: issues taken, PRs opened/merged, decisions made, failures and what restarts them, and the frontier that remains. Then update the session handoff memory.
