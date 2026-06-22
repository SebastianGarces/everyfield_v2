---
name: handoff
description: Create or resume a session handoff. Use when the user says "/handoff", "create a handoff", "hand off", "wrap up the session", "I'm going to clear context", or (resume) "resume", "where were we", "/handoff resume". Captures current session state to project memory so the next session picks up instantly.
---

# Handoff Skill

Purpose: let the user end a session with `/handoff` and have the next session know exactly where to continue — what's done, what's next, and the first action to take. Built on the project's auto-loaded memory system, so retrieval is automatic.

## Two modes

### Create (default: `/handoff`)
Write a fresh handoff capturing the current session, persist it, and print it in chat.

### Resume (`/handoff resume`, or when the user asks "where were we?")
Read the latest handoff and restate the plan + the immediate next action. (Usually unnecessary — the pointer in `MEMORY.md` is auto-loaded at session start — but use this to explicitly re-orient.)

## Where it's saved (and why retrieval is automatic)

The project's Claude memory directory is auto-indexed by `MEMORY.md`, which is injected into context at the start of every session. So:

- **Rolling handoff file:** `<project-memory-dir>/session_handoff.md` — **overwritten** every `/handoff` (one current handoff, never accumulating). For this project the memory dir is `/Users/sebastian/.claude/projects/-Users-sebastian-dev-everyfield-v2/memory/` (it's also shown in the memory instructions each session — use whatever path is given there).
- **Pointer in `MEMORY.md`:** keep exactly one line pointing to it, e.g.
  `- [▶ Latest handoff](session_handoff.md) — <one-line status + the next action>`
  Update that line's text each time; do not add a second handoff pointer.

Because `MEMORY.md` loads automatically next session, the next session sees the pointer without the user doing anything. Reading `session_handoff.md` then restores full continuity.

## Create procedure

1. **Check real state first.** Run `git status --short` and `git log --oneline -5` so the handoff reflects what's actually committed vs. uncommitted. Don't claim work is committed if it isn't.
2. **Write `session_handoff.md`** (overwrite) using the template below.
3. **Update the `MEMORY.md` pointer line** (text only; one line).
4. **Fold durable facts into proper memories.** The handoff is point-in-time and disposable. Anything that should outlive this task (a locked decision, an architecture change, an ongoing project thread) belongs in a normal `project`/`feedback`/`reference` memory file too — don't let durable facts live only in the rolling handoff.
5. **Print the handoff in chat** so the user can read/copy it, then tell them it's safe to clear.

## Handoff template

```markdown
# Handoff — <project / focus> (<absolute date>)

## Where we are
<1–3 sentences: the current state and what this session accomplished.>

## Artifacts this session
<Files created/changed, each with committed vs. uncommitted status. Be precise.>

## Decisions locked
<Key decisions made, so they aren't re-litigated.>

## ▶ Start the next session here
<The single most important next action, concrete enough to act on immediately — file paths, commands, the exact unit/task.>

## Then
<Ordered subsequent steps / the plan after the first action.>

## Blockers / pending
<External dependencies, approvals, or info still needed — with dates where relevant (convert "next week" to an absolute date).>

## Suggested opening prompt
> "<a ready-to-paste first message for the next session>"
```

## Rules

- **One rolling handoff.** Always overwrite `session_handoff.md`; never create `handoff-2.md` etc.
- **One pointer.** Keep a single `MEMORY.md` line for the latest handoff; update its text in place.
- **Ground it in `git`.** Verify committed/uncommitted state before describing it.
- **Lead with the next action.** The `▶ Start here` section is the point of the whole document — make it concrete and unambiguous.
- **Absolute dates.** Convert relative dates ("next week", "Monday") to absolute.
- **Concise.** A handoff is a launchpad, not a transcript. Link to specs/memories rather than restating them.
- **Generic.** Nothing here is project-specific except the memory-dir path, which is provided in context each session.
