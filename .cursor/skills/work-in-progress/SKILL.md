---
name: work-in-progress
description: Use to plan and execute current feature implementation.
---

# WIP – Working Feature Implementation Skill

## When to Use

* When starting implementation work on a feature
* When the user references `working-feature/` directory
* When asked to plan or prepare implementation for an FRD

## Purpose

The `working-feature/` directory is an ephemeral workspace for planning and executing feature implementation.
It provides structure without requiring version control of planning artifacts.

## Available Agents

Delegate to specialized agents based on the task:

| Agent | Use For |
|-------|---------|
| `architect` | Implementation plans, FRDs, system design, documentation |
| `frontend` | Components, pages, layouts, UI, client/server decisions |
| `backend` | API routes, database schemas, queries, Server Actions |
| `code-reviewer` | Pre-commit review, security, performance, simplicity |

**Delegation guidelines:**
- Use `architect` when creating `implementation.md` or making architectural decisions
- Use `frontend` for UI components and React/Next.js client work
- Use `backend` for data layer, API routes, and server-side logic
- Use `code-reviewer` before committing any code changes

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
2. Create `notes.md` using the template below
3. Delegate to `architect` agent to create `implementation.md`
4. Apply **Risk Gate** (see below)

### 2. Executing Implementation

1. Load context (see Context Loading below)
2. Work through phases in `implementation.md`
3. Delegate to appropriate agent:
   - Frontend work → `frontend` agent
   - Backend work → `backend` agent
4. Update memory if contracts/flows change

### 3. Before Committing

1. Run `code-reviewer` agent on changes
2. Address any critical issues
3. Follow Completion Workflow

## Risk Gate (IMPORTANT)

Determine risk level before proceeding.

**High-risk changes** (STOP and wait for approval):

* Database schema or migrations
* Auth / permissions / roles
* Payments or billing
* Multi-tenant boundaries
* Security-sensitive data flows

**Low / medium-risk changes**:

* UI changes
* Local logic refactors
* Non-breaking API changes
* Internal tooling

### Behavior

* **High risk** → STOP after planning and wait for explicit approval
* **Low / medium risk** → Proceed after plan unless user says "stop"

## notes.md Template

```markdown
# [Feature Name] – Implementation Notes

**FRD:** `product-docs/features/<feature-name>/frd.md`
**Date Started:** YYYY-MM-DD
**Risk Level:** Low / Medium / High

## Goal

[One sentence describing what we're building]

## Key Decisions

-

## Constraints

-

## Acceptance Criteria

- [ ] What must be true for this to be considered done

## Verification

- Commands to run
- Manual checks (if any)

## Open Questions

-

## Out of Scope

-

## FRD Issues (if any)

- Gaps, ambiguities, or inconsistencies found in FRD
```

## implementation.md Template

Delegate creation of this document to the `architect` agent, providing:
- The target FRD path
- Scope (MVP / Full / Specific requirements)
- Any constraints from `notes.md`

The architect will create a detailed plan including:
- Requirements covered
- Implementation phases and steps
- File changes table
- Database schema (if applicable)
- API routes (if applicable)
- Components (if applicable)

## Rules

### Pause for Review

* If **High risk** (per Risk Gate): STOP after creating `notes.md` and `implementation.md` and wait for explicit user approval.
* If **Low / Medium risk**: proceed after planning unless user says "stop".

### DO NOT Modify FRDs

The FRD is the source of truth.

* If the FRD has errors or gaps, note them in `notes.md` under **FRD Issues**
* Propose FRD changes separately, not during implementation
* Implementation must conform to FRD requirements

### Reset Before New Features

Always reset the directory when switching features. Delete all files except `README.md`:

```bash
cd working-feature && find . -type f ! -name 'README.md' -delete
```

### Context Loading

When working on implementation, load:

1. **`memory/entrypoints.md`** - First, to understand flow entry points
2. **Relevant `memory/flows/*.mmd`** - For the area being modified
3. **Relevant `memory/contracts/*.md`** - For interface details
4. `working-feature/notes.md`
5. `working-feature/implementation.md`
6. The target FRD (read-only reference)
7. `product-docs/system-architecture.md` (for tech stack and constraints)

Do NOT load other FRDs unless there is a cross-feature dependency.
Do NOT open source files if memory provides sufficient context.

### Token Efficient Output Defaults

* Prefer **unified diffs** / patches
* Do not restate unchanged code
* No explanations unless explicitly asked
* Do not widen scope or add "nice-to-haves" unless requested
* If blocked, ask **exactly one** short question

## Memory Maintenance

The `memory/` directory contains summarized context for AI agents. Keep it accurate and minimal.

### What Belongs in Memory

- **Entrypoints** - Flow entry points with file:symbol references
- **Flows** - Mermaid diagrams of control/data flow
- **Contracts** - API routes, DB schema, config summaries
- **Invariants** - Rules that must not be violated

### During Planning

After creating `notes.md` and `implementation.md`, determine if planned changes impact:

- [ ] Entrypoints (new routes, actions, triggers)
- [ ] Flows (control flow changes)
- [ ] Contracts (schema, API, config)
- [ ] Invariants (security, tenancy, auth)

If yes, add explicit checklist items to `implementation.md` for updating relevant `memory/*` files.

### During Execution

If implementation changes any of the following, update memory **in the same phase** (not after):

- New or modified routes/actions
- Database schema changes
- API contract changes
- Config/env var changes
- Auth or tenancy behavior

### Before Commit (Memory Check)

1. Review touched areas against memory contents
2. If changes imply memory drift, ensure memory was updated
3. If no drift, add to `notes.md` under a "Memory" subsection:
   ```
   ## Memory
   Memory unchanged - no impact on entrypoints, flows, contracts, or invariants.
   ```

### Memory Quality Rules

- **Do NOT dump code** into memory - summarize + link to file paths
- **Keep it small** - total budget ≤50 KB
- **Anchor nodes** in Mermaid diagrams to `file:function()` or `file route`
- **Split diagrams** if they grow too large (>50 lines)
- Prefer adding diagrams only when they prevent future file reads

---

## Completion Workflow

### After Each Phase

When a phase is completed:

1. Ask: "Phase complete — continue to next phase or adjust plan?"

2. If continuing: proceed with the next phase from `implementation.md`

3. If done: run `code-reviewer` agent before committing

### Before Commit

1. **Run code-reviewer agent** on all changes
2. Address any critical issues raised
3. Propose a commit message:

   ```
   <type>: <short summary>

   <optional body explaining what and why>
   ```

   Types: `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `chore`

4. Update checklists:
   * `working-feature/implementation.md` (check off completed items)
   * `product-docs/features/<feature-name>/checklist.md` (if exists)

5. Follow Selective Commit Protocol below

## Selective Commit Protocol

**IMPORTANT**: Multiple LLM agents may be working in this repository simultaneously. Only commit files directly related to the current task.

1. Run `git status` to see all modified, staged, and untracked files.

2. Identify task-related files: determine which files were modified as part of THIS task only.

3. Check for unrelated changes: if there are modified files NOT related to the current task:

   * List the unrelated files to the user
   * Ask: "These files were also modified but appear unrelated to this task: `[file list]`. Do you want to include them in this commit, or commit only the task-related files?"
   * Wait for user response before proceeding

4. Stage selectively: only stage the files the user confirms:

   ```bash
   git add <file1> <file2> ...
   ```

   Do NOT use `git add -A` or `git add .` unless the user explicitly confirms all changes should be included.

5. Commit with the confirmed message.

## Resetting the Directory

When the user asks to "reset" or "start fresh" on a new feature:

1. Delete all files in `working-feature/` except `README.md`
2. Create fresh `notes.md` using the template
3. Delegate to `architect` agent to create `implementation.md`
4. Populate based on the target FRD
