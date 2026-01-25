# Working Feature Directory

This directory is a **workshop space** for planning and implementing features. Contents here are ephemeral and should not be relied upon for historical reference.

## Purpose

- Plan implementation approach before coding
- Document decisions and constraints for current work
- Create detailed implementation steps
- Iterate freely without polluting main documentation

## Files

| File | Purpose | Persists on Reset |
|------|---------|-------------------|
| `README.md` | This file - explains the workspace | Yes |
| `notes.md` | High-level thoughts, decisions, open questions | No |
| `implementation.md` | Detailed implementation plan | No |

## Starting a New Feature

Use this prompt template to begin work on a new feature:

---

**Prompt Template:**

```
I want to start working on [FEATURE NAME].

FRD: @product-docs/features/[feature-name]/frd.md
Scope: [MVP requirements only / Full FRD / Specific requirements: X-001 through X-012]

Context:
- [Any relevant constraints, dependencies, or prior decisions]
- [What's already in place that this builds on]

Please:
1. Reset the working-feature directory
2. Set up notes.md and implementation.md for this feature
3. Create an implementation plan based on the FRD
```

---

**Example:**

```
I want to start working on People/CRM.

FRD: @product-docs/features/people-crm/frd.md
Scope: MVP requirements only (P-001 through P-012)

Context:
- Database and auth are already set up
- This is the first feature being implemented
- Need to establish patterns for list/detail views

Please:
1. Reset the working-feature directory
2. Set up notes.md and implementation.md for this feature
3. Create an implementation plan based on the FRD
```

---

## Reset Procedure

When starting a new feature, delete all files except `README.md`:

```bash
cd working-feature && find . -type f ! -name 'README.md' -delete
```

Or ask the AI to reset the directory for you as part of the starter prompt.

## Rules

1. **Do not modify FRDs** - The FRD is the source of truth. Note issues in `notes.md`.
2. **Reset before new features** - Always start fresh.
3. **This is ephemeral** - Don't rely on this directory for history.
