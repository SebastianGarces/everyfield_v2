---
name: memory-first
description: Load memory pack first to minimize tokens and file reads.
---

# Memory-First Skill

## When to Use

- Before starting any task in this repository
- When understanding architecture or flows
- Before opening source files

## Purpose

The `memory/` directory contains summarized context about the codebase. Loading it first reduces token usage and prevents unnecessary file reads.

## Required Reading Order

1. **`memory/entrypoints.md`** - Always read first to understand where flows start
2. **Relevant `memory/flows/*.mmd`** - Visual flow for the area you're working in
3. **Relevant `memory/contracts/*.md`** - Interface details (API, DB, config)
4. **`memory/invariants.md`** - Before any mutation, check rules that must not be violated

## Rules

### Do NOT Open Code If Memory Suffices

If the task can be completed using only memory context:
- Do not open additional source files
- Reference memory file paths in your response
- Default output: unified diff only

### When to Open Code

Open source files only when:
- Memory references a file but lacks the specific detail needed
- Implementing changes that require seeing current implementation
- Memory explicitly says "see source for implementation"
- Debugging unexpected behavior

### Minimal File Access

When opening code is necessary:
- Open only files referenced in memory entrypoints
- Prefer reading specific functions, not entire files
- If blocked, ask exactly one short question

### Output Format

- Default: unified diff with ±3 lines context
- No explanations unless explicitly asked
- No code restatement
- Do not widen scope or add "nice-to-haves"

## Memory Contents

| File | Purpose |
|------|---------|
| `memory/README.md` | Overview |
| `memory/index.md` | TOC + decision guide |
| `memory/entrypoints.md` | Flow entry points |
| `memory/invariants.md` | Rules that must not be violated |
| `memory/contracts/api.md` | API routes and actions |
| `memory/contracts/db.md` | Database schema |
| `memory/contracts/config.md` | Environment and config |
| `memory/flows/auth.mmd` | Authentication flow |
| `memory/flows/wiki-article.mmd` | Wiki article retrieval |
| `memory/flows/request-lifecycle.mmd` | Dashboard request lifecycle |

## Memory Maintenance

Memory is updated when changes affect:
- **Entrypoints** - New routes, actions, or triggers
- **Flows** - Control flow changes
- **Contracts** - Schema, API, or config changes
- **Invariants** - Security, tenancy, or auth rules

See the WIP skill (`.cursor/skills/work-in-progress/SKILL.md`) for memory maintenance workflow during feature implementation.

## Size Budget

Total memory size must stay **≤50 KB**.

- Do not dump entire schemas or code blocks into memory
- Summarize + link to file paths
- Split diagrams if they grow too large
