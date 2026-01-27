---
name: work-in-progress
description: Use to plan current task.
---

# WIP – Working Feature Implementation Skill

## When to Use

- When starting implementation work on a feature
- When the user references `working-feature/` directory
- When asked to plan or prepare implementation for an FRD

## Purpose

The `working-feature/` directory is an ephemeral workspace for planning and executing feature implementation. It provides structure without requiring version control of planning artifacts.

## Directory Structure

```
working-feature/
├── README.md           # Permanent - do not delete
├── notes.md            # High-level notes for current feature
└── implementation.md   # Detailed implementation plan
```

## Workflow

### 1. Starting a New Feature

When beginning work on a feature:

1. Reset the directory (keep only `README.md`)
2. Create `notes.md` with the header template
3. Create `implementation.md` with the implementation template
4. **STOP and wait for user review** before proceeding with implementation

### 2. notes.md Template

```markdown
# [Feature Name] - Implementation Notes

**FRD:** `product-docs/features/<feature-name>/frd.md`
**Date Started:** YYYY-MM-DD

## Goal

[One sentence describing what we're building]

## Key Decisions

- 

## Constraints

- 

## Open Questions

- 

## Out of Scope

- 
```

### 3. implementation.md Template

```markdown
# [Feature Name] - Implementation Plan

**FRD:** `product-docs/features/<feature-name>/frd.md`
**Scope:** [MVP / Full / Specific requirements]

## Requirements Covered

[List requirement IDs from FRD being implemented, e.g., P-001 through P-012]

## Implementation Steps

### Phase 1: [Name]

- [ ] Step 1
- [ ] Step 2

### Phase 2: [Name]

- [ ] Step 1

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `path/to/file` | Create | Description |

## Database Schema

[If applicable]

## API Routes

[If applicable]

## Components

[If applicable]
```

## Rules

### Pause for Review

After creating `notes.md` and `implementation.md`, **always stop and wait for user review** before proceeding with any implementation work. Do not begin coding until the user explicitly approves the plan.

### DO NOT Modify FRDs

The FRD is the **source of truth**. Implementation planning happens in `working-feature/`, not by editing FRDs.

- If the FRD has errors or gaps, note them in `notes.md` under "FRD Issues"
- Propose FRD changes separately, not during implementation
- Implementation must conform to FRD requirements

### Reset Before New Features

Always reset the directory when switching features. Delete all files except `README.md`:

```bash
cd working-feature && find . -type f ! -name 'README.md' -delete
```

### Context Loading

When working on implementation, load:

1. `working-feature/notes.md`
2. `working-feature/implementation.md`
3. The target FRD (read-only reference)
4. `product-docs/system-architecture.md` (for tech stack and constraints)

Do NOT load other FRDs unless there is a cross-feature dependency.

### Keep notes.md Light

`notes.md` is for:

- High-level decisions
- Constraints discovered during implementation
- Questions to resolve
- Things explicitly out of scope
- FRD issues (if any found)

NOT for:

- Detailed implementation steps (use `implementation.md`)
- Code snippets (use `implementation.md`)

### Keep implementation.md Actionable

`implementation.md` should be:

- Specific enough to execute
- Organized in phases/steps
- Updated as work progresses (check off completed items)
- Include file paths, schema definitions, component names

## Completion Workflow

### After Each Implementation Step

When an implementation task is completed:

1. **Ask for confirmation**: "Is this change complete, or do we need to continue with more changes?"

2. **If continuing**: Proceed with the next implementation step from `implementation.md`

3. **If done**:
   - Propose a commit message following this format:
     ```
     <type>: <short summary>
     
     <optional body explaining what and why>
     ```
   - Types: `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `chore`
   - Wait for user confirmation or edits to the message

4. **After commit message confirmed**: Execute the git commit following the **Selective Commit Protocol** below.

5. **Update implementation.md**: Check off completed items in the implementation plan

### Selective Commit Protocol

**IMPORTANT**: Multiple LLM agents may be working in this repository simultaneously. Only commit files directly related to the current task.

1. **Run `git status`** to see all modified, staged, and untracked files.

2. **Identify task-related files**: Determine which files were modified as part of THIS task only.

3. **Check for unrelated changes**: If there are modified files NOT related to the current task:
   - List the unrelated files to the user
   - Ask: "These files were also modified but appear unrelated to this task: `[file list]`. Do you want to include them in this commit, or commit only the task-related files?"
   - Wait for user response before proceeding

4. **Stage selectively**: Only stage the files the user confirms:
   ```bash
   git add <file1> <file2> ...
   ```
   Do NOT use `git add -A` or `git add .` unless the user explicitly confirms all changes should be included.

5. **Commit**:
   ```bash
   git commit -m "<confirmed message>"
   ```

## Resetting the Directory

When the user asks to "reset" or "start fresh" on a new feature:

1. Delete all files in `working-feature/` **except** `README.md`
2. Create fresh `notes.md` using the template
3. Create fresh `implementation.md` using the template
4. Populate based on the target FRD
