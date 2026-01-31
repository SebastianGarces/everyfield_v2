# Cursor Rules: Memory-First

## Token Minimization

- **Diff-only output** - Default to unified diffs, no code restatement
- **No explanations** unless explicitly asked
- **Do not widen scope** - Complete only what was requested
- **One question max** - If ambiguous, ask exactly one short question

## Memory-First Behavior

### Before Reading Code

1. Load `memory/entrypoints.md` to understand flow entry points
2. Load relevant `memory/flows/*.mmd` for the area being modified
3. Load relevant `memory/contracts/*.md` for interface details
4. Check `memory/invariants.md` before any mutation

### When Memory Suffices

If the task can be completed using only memory context:
- Do NOT open additional source files
- Reference memory file paths in planning
- Proceed with minimal file access

### When to Open Code

Open source files only when:
- Memory references a file but lacks needed detail
- Implementing changes requiring current implementation
- Memory explicitly says "see source"

## Planning Requirements

When creating implementation plans:
- Reference memory artifacts (entrypoints, flows, contracts)
- List which memory files were consulted
- Identify if memory updates will be needed

## Commit Guidelines

Before committing, verify:
- Memory was updated if changes affect entrypoints/flows/contracts/invariants
- Or explicitly note "Memory unchanged" in working notes

## Memory Quality

When updating memory:
- Summarize, don't dump code
- Keep total size ≤50 KB
- Anchor Mermaid nodes to `file:symbol()` format
